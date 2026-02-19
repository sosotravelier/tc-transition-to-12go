General Principles
Currencies and monetary values
Whenever a monetary value is communicated from the API, we use the following structure:

JSON

{
  "currency":"USD",
  "amount":"14.60"
}
Note that amounts are strings with decimal points. This is to avoid running into issues with floating point implementation in different programming languages. The precision depends on the typical lowest denomination for that currency. E.g. for USD the lowest denomination is a cent and so the precision will be two digits.

Correlation and Experiment IDs
In the headers, you will also find x-correlation-id and x-api-experiment. It is optional but recommended to use these headers.

x-correlation-id - This header is used to help us measure and improve conversion rates between search, checkout, and book phases. It facilitates tracking requests through the system, enabling better analysis of user behavior and system performance.

x-api-experiment - This header is used to maintain consistency in the responses received from the API, ensuring that the responses are returned from the same source. This is particularly useful for A/B testing, where responses might otherwise be randomly varied.

The x-api-experiment header ensures that every response is returned from the same source, preserving the consistency required for accurate testing and analysis. In some cases, we would run the A/B tests to improve various aspects of the system, and this header would also give you control and visibility into those tests.

We provide these headers in responses so clients know what experiment flow is applied to the request. You can optionally include this header in your requests to override our experimentation mechanism and enforce a certain flow.

X-REQUEST-Id

Confirmation and Ticket Types
There are two confirmation_types

Instant: The booking is confirmed immediately, and the confirmation details are provided in the API response.
Pending: The booking is not confirmed immediately. Instead, the confirmation is provided asynchronously once the supplier has approved or declined the reservation.
There are three ticket_types

Paper Ticket: A traditional, physically printed ticket that must be presented at the time of boarding.
Show On Screen: A digital ticket displayed on a mobile device, often containing a QR code or barcode for scanning.
Pick Up: A ticket purchased online but collected as a physical copy from a designated location before the journey.
206 Partial Error
A 206 Partial Result response indicates that the integration partner returned incomplete data due to an issue on their system. When this occurs, Travelier Connect attempts to refresh the data from the supplier. To address this:

Wait for a short period (about half a second).
Although this is optional, you can perform another search to try and retrieve the full results. However, most of the results would already arrive. You may use the 206 to try obtaining more results, but it’s not mandatory.
Date, time, timezones, periods
Dates are local time where available - departure and arrival times for example
ISO defined Periods are used for durations where applicable (e.g. PT1D12H means 1 day and 12 hours)
Country codes follow ISO standards (ISO 3166-1), using standard two-letter country codes (e.g. TH, DE, FR)