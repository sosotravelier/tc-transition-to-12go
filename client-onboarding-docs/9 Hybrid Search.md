Hybrid Search (On-Demand Fetch)
Hybrid Search via On-Demand Fetch (ODF) enhances the search experience by combining cached search results with real-time supplier API calls. This approach increases inventory coverage and improves the completeness of search responses without impacting overall system stability. ODF allows the platform to return available cached results immediately while additional inventory is retrieved asynchronously from suppliers when needed.

Benefits
Hybrid Search with ODF provides the following advantages:

Increased inventory coverage by including results that are not available in cache
Improved conversion rates through more complete and relevant search results
Intelligent balancing between cached data and real-time supplier calls to optimize availability and performance
API Response Behavior
When ODF is enabled, search endpoints may return one of the following HTTP status codes:

200 OK
All expected results are available and included in the response.

206 Potential Additional Content
Partial results are returned. Additional non-critical inventory may still be in the process of being retrieved from suppliers. This background retrieval improves result completeness for subsequent searches.

Handling 206 Potential Additional Content
Partners can choose how to handle 206 responses based on their application requirements:

Ignore 206
Treat the partial response as final. Remaining inventory will continue to be processed in the background and may appear in future searches.

Polling
Repeat the search request until a 200 OK response is returned or a client-defined timeout is reached.

Deployment and Integration
Hybrid Search via ODF is enabled by default and does not require any changes to existing integrations. Partners only need to decide whether to implement specific handling for the 206 Potential Additional Content response. For questions or if you plan to change your current handling of the 206 status code, contact the Travelier Connect Customer Success team.

