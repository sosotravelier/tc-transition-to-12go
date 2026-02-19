Cancellation and Refund Policies
The cancellation policies define the conditions under which a customer can cancel a booking and the penalties or refunds applicable depending on the time of cancellation. These policies can vary depending on the time frame before the scheduled booking and the penalties applied for each stage. The cancellation_policies array provides a structured way to represent these conditions

Structure of Cancellation Policies
The cancellation policies are represented as an array of objects, each detailing the applicable penalties for cancellations. Each object consists of the following components:

from: Defines the time period before the scheduled booking for which the cancellation policy is valid. This is an optional field and uses the ISO 8601 duration format. For example, "P2D" refers to a period of two days (48 hours).
penalty: This section details the penalty applied if a cancellation is made within the specified time frame. The penalty can be expressed as either:
percentage: A percentage of the total booking amount that will be withheld as a penalty. For example, a 10% penalty means that 10% of the total booking amount will be charged.
cost: A fixed fee charged in a specific currency, where the penalty is specified using two fields:
currency: The currency in which the penalty is charged (e.g., USD).
amount: The fixed amount charged as a penalty.
Examples of a Cancellation Policy
Each object within the cancellation_policies array covers a different period leading up to the booking and assigns the applicable penalty for cancellations made during that period. E.g.:

Free Cancellation Up to 48 Hours Before Departure
The first object defines a free cancellation policy where no penalty is applied if the booking is canceled anytime after the booking is made. The from value is null, meaning that no penalty applies from the time of booking until a specified point before departure. The penalty percentage is set to 0, indicating no charge:
JSON

{
	"from": null,
	"penalty": {
		"percentage": 0 // no penalty, full refund
	}
}
$20 Charge for Cancellations Within 48 to 24 Hours
The second object specifies that if the cancellation occurs within 48 hours before the booking, a fixed penalty of $20 is applied. The from field uses "P2D" (48 hours), and the penalty includes a fixed cost in USD currency:
JSON

	{
		"from": "P2D", // 48 hours
		"penalty": {
			"cost": {
				"currency" : "USD",
				"amount" : "20.0"
			}
		}
	}
Non-Refundable Within 24 Hours
The third object defines that cancellations made within 24 hours of the departure time are non-refundable, with a penalty of 100%. The from field is "P1D" (24 hours), and the penalty is set to 100%, indicating the full amount of the booking will be charged as a penalty:
JSON

{
	"from": "P1D", // 24 hours
	"penalty": {
		"percentage": 100 // non-refundable
	}
}
Example for cutt-off
The cut_off field defines when bookings for a trip must stop before departure. For instance, if bookings are no longer allowed 24 hours before departure, the cut_off value would be "PT24H". This means customers cannot make any new bookings within 24 hours of the scheduled departure:
J

{
    "cut_off": "PT24H"
}

Key Points
Flexibility in Duration: By using ISO 8601 durations, the system allows flexibility in defining different cancellation windows. For example, "P2D" refers to two days (48 hours), and "P1D" refers to one day (24 hours).
Customizable Penalties: The system supports both percentage-based penalties and fixed costs, allowing different approaches to handling cancellations depending on business rules and requirements.
Transparency for Users: Clearly defined cancellation policies help manage user expectations by providing transparent guidelines on when refunds are applicable and what penalties apply for cancellations.
Cutoff Flexibility: The cut_off field allows to define when the trip can no longer be sold, giving control over when the sales window closes relative to the departure time of a trip.