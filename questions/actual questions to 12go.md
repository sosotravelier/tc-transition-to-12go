What's the current strategy about development of new features? Do you consider alternatives to php? I see there are V2 controllers
- Search - SearchController. MariaDb


How do you scale parts of your system? You have search and booking. Do you scale them independently? Or is it a monolyth?
- 8 instances - Autoscaling
- 

What do you use for service orchestration? k8s, ecs, ec2s.

Which environments do you have?
- Local - 
- Staging - feature branch
- Future - Staging for each feature/team
- PreProd (Canary)
- Prod

As I recall you have mySql, redis, php and kafka. What else? YOu use openTelemetry for metrics and traces?
- MariaDb
- Redis for caching / mem cache
- Kafka only for business events
- Clickhouse for analytics

Where are configurations
All configurations related to integration are in db
InfrastructureConfigs
.env

Documentation
- jira and atlassian

You are working on Seat lock feature?

Static data endpoints?

Logs are on datadog, right?

Monitoring capabilities - per bookingId, per client, per operator


Integrations





Future
- Split 
