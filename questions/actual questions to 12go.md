What's the current strategy about development of new features? Do you consider alternatives to php? 
- Go lang is considered as an alternative

- Search corresponds to SearchController. Backed by mariaDb. Re-checks are performed if data in mariadb is outdated. Searches are fast while rechecks are slow since they go to actual integration.
Might take up to 1 minute.


How do you scale parts of your system? You have search and booking. Do you scale them independently? Or is it a monolyth?
- 8 instances of ec2. f3 is monolyth.
  

What do you use for service orchestration? 
- All the infra concerns are handled by devops. Devopses are also handling configurations. When a feature is released, in the release request to devops developer should write what has changed in configurations.

Configurations of integrations are stored in db. Local configurations are in .env file.

Which environments do you have?
- Local - Run through docker.
- Staging - developers deploy there feature branches for QAs to test it before advancing further.
- Devopses are considering to add more staging envs to help against conflicts.
- PreProd (Canary) - Almost prod with real connections but no clients calls it. 
- Prod

As I recall you have mySql, redis, php and kafka. What else? YOu use openTelemetry for metrics and traces?
- MariaDb
- Redis for caching / mem cache
- Kafka only for business events
- Clickhouse for analytics


Documentation
- jira and atlassian. To find about certain piece of code, one can do git blame, find commit message that has jira ticket in it and approach the author.

You are working on Seat lock feature? - Didn't have a chance to ask it.

Static data endpoints? - Forgot to ask them

Logs are no datadog. Metrics are defined by business people. The person I was asking only was using to monitor cpu and memory usages.

Actual integrations are handled in Integrations services by another team and I need to clarify if there are details that might be relevant.

So for the future GoLang is considered. But it's not final.


