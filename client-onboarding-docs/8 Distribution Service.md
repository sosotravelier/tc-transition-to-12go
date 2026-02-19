Distribution Service
The Distribution Service is a supplementary component to our API ecosystem designed to manage and deliver the right products to the right clients under the right conditions. It determines which itineraries, routes, and services are available to the client based on their specific preferences, contracts, and applicable business rules (e.g., whitelists and blacklists).

What Does the Distribution Service Provide?
Product Availability Management:
The Distribution Service continuously evaluates client-specific contracts and applies distribution rules to determine which products (e.g., transport routes, schedules) are available for a client.
It filters out unavailable or blocked products based on the client’s specific business rules, ensuring that only relevant options are presented.
Real-Time Rule Application:
The service dynamically applies business rules such as whitelists (allowed products) and blacklists (blocked products) to each client’s available inventory. These rules are based on attributes like operators, contracts, and geographic routes.
It adapts to changes in real-time, ensuring that product availability reflects the most current contract and rule conditions.
For businesses integrating with our API the Distribution Service offers a streamline process of managing complex product offerings, ensures compliance with the contractual preferences, and adapts to the real-time changes in rules.

Example of the rule:

JSON

[
		{
      "rule_id": "abc12d92sss",
      "operators_id": ["XYZ"],  
      "rule_type": "allow"
    },
    {
      "rule_id": "asssbc12d92sss",
      "operators_id": ["AAA"],  
      "rule_type": "block"
    },
    {
      "rule_id": "abc12d9sss2sss",
      "rule_type": "allow"
    },
    {
      "rule_id": "abc12d92b",
      "trip_window": {
        "from": "2024-07-01T00:00:00",
        "to": "2024-09-01T23:59:59"
      },
      "operators_id": ["XYZ"],  
      "rule_type": "block"
    },
    {
      "rule_id": "abcssss12d92b",
       "rule_window": {
        "from": "2024-08-01T00:00:00",
        "to": "2024-09-01T23:59:59"
      },
      "trip_window": {
        "from": "2024-08-01T00:00:00",
        "to": "2024-08-0071T23:59:59"
      },
      "operators_id": ["XYZ"],  
      "rule_type": "allow"
    }
  ] 