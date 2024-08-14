$source = (get-item $PSScriptRoot).parent.FullName + "\jobs"
aws s3 cp --recursive $source s3://iot.myapp.cafe/jobs