API Versioning
Whenever breaking changes are introduced to the API, a new version is released. Version names are in the YYYY-MM-DD format indicating their date of release.

A specific version of the API should be provided in the request headers under “Travelier-Version:”. If you use a version that is no longer available, a 400 error will be returned as a response.

When we release a new version with breaking changes, a deprecation date is set for older versions.

If a client uses an old version which has a deprecation date, a header will be included in the response headers to indicate that this version is about to deprecated and at which point in time, e.g.: Deprecation: 2023-11-14

The currently latest version of the API is 2023-07-01