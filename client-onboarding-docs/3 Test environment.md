Test environment
All of our endpoints are also available as test endpoints on our development environment.

Dev env URLs are based at https://integration-dev.travelier.com/v1/client_id/

The API key for the dev env will be provided by your contact at Travelier, and is different to the one used for production.

⚠️ Important note about staging environment data: The staging environment is intended for integration and technical testing only. All data in this environment is simulated and must not be used for commercial or analytical purposes. This includes, but is not limited to:

Price
Trip availability
Stations and POI identifiers (IDs differ from production)
Do not perform any data mapping while using the staging environment. Station IDs, POI IDs, and other reference identifiers are different from production and will change. Mapping should only be done after production access is granted. Partners should not rely on or extract any commercial insights from the staging environment, as the data does not reflect real production inventory.