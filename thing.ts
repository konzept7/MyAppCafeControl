import { Iot, config } from 'aws-sdk';
// import { ControllableProgram } from './controllableProgram'
// import { Myappcafeserver } from './myappcafeserver'

enum ThingType {
  Server,
  Gate,
  Cam,
  Terminal,
  Queue
}

class Thing {
  public name!: string;
  public thingType: ThingType | undefined;
  public attributes: {
    [index: string]: string
  } | undefined;
  public groups: Array<string> | undefined;

  constructor(name: string) {
    this.name = name;
  }
}

class ThingFactory {
  static async createThing(thingName: string, region: string): Promise<Thing> {
    return new Promise((resolve, reject) => {
      // TODO: get credentials the right way (refer to iot security)
      try {
        config.getCredentials(function (err: any) {
          if (err) console.log(err.stack);
          // credentials not loaded
          else {
            console.log("Access key:", config?.credentials?.accessKeyId);
          }
        });
      } catch (error) {
        console.error('error getting credentials', error);
        reject('error getting credentials')
      }

      const thing = new Thing(thingName);

      const iot = new Iot();
      const r: Iot.Types.DescribeThingRequest = { thingName: thing.name };
      iot.describeThing(r, (error, data) => {
        if (error) {
          console.error(error);
          reject('error describing thing ' + thing.name);
          return;
        }
        if (!data.thingTypeName) throw new Error('no type attached to thing');
        thing.thingType = ThingType[data.thingTypeName! as keyof typeof ThingType];
        const attributes = data.attributes!;
        thing.attributes = attributes;

        iot.listThingGroupsForThing({ thingName: thing.name }, async (error, data) => {
          if (error) {
            console.error(error);
            reject('error describing thing ' + thing.name);
            return;
          }
          thing.groups = data.thingGroups?.map(g => g.groupName!) || [];
          await Promise.all(thing.groups.map(group => {
            return new Promise(r => {
              iot.describeThingGroup({ thingGroupName: group }, (error, data) => {
                if (error) {
                  console.error(error);
                  reject('error describing thing ' + thing.name);
                  return;
                }
                if (data.thingGroupProperties?.attributePayload?.attributes) {
                  thing.attributes = { ...thing.attributes, ...data.thingGroupProperties!.attributePayload!.attributes! }
                }
              })
              r(null);
            })
          }))
          resolve(thing);
        })
      })
    })
  }
}

export { Thing, ThingType, ThingFactory }