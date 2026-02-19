
Key Concepts and Terminology
Operator
An operator is an entity responsible for providing and managing the transportation service. This includes owning or leasing the vehicle, operating it, and ensuring the fulfillment of the trip. Examples include bus companies, ferry operators, and train companies.

Supplier
A supplier is a business entity that bridges the connection between the operators and customers by managing the inventory. This entity could be a Transportation Management System (TMS), an Online Travel Agency (OTA), or another intermediary that facilitates the sale and distribution on travel service.

Vehicle
A vehicle is the type of machinery used to complete an itinerary. Common examples include busses, minibuses, ferries, and trains.

Class
Class refer to the service tier available on a vehicle. Common classes include economy, business, and VIP. Different operators may use the unique names for their service classes, which might reflect different levels of comfort, amenities, and pricing.

Amenities
Amenities are additional features provided with a ride class. They can include services like WiFi, baggage allowance, meals, power outlets, and more, enhancing the travel experience for passengers.

Station
A station is a physical location where a vehicle begins or ends a segment. Stations serve as departure and arrival points for segments. Examples include bus stops, train stations, and ferry terminals.

POI (Point of Interest)
A Point of Interest (POI) is a grouping of stations that can represent cities, areas, tourist destinations, or central hubs with multiple stations. POIs are used in search queries to simplify finding travel options, although the actual travel occurs between specific stations.

Segment
A segment is a portion of a journey that takes place between the two stations using a single type of vehicle. Segments are not sold individually; they must be a part of a complete itinerary. For example, a bus ride from Station A to Station B.

Itinerary
An itinerary is the complete, purchasable journey that includes one or more segments. It can be configured as a direct trip or a return trip with specific departure times and operators. It also includes purchase metadata such as pricing, cancellation policies, and additional details needed for the booking process.

Inventory
The available list of operators, carrier partners, and the services they offer. In the context of Travelier Connect, inventory refers to the comprehensive set of transportation options provided by various operators and partners that can be booked through the system. This includes details about the available routes, schedules, and capacities offered by each operator.

Seat
A seat is an individual place assigned to a passenger on a specific itinerary. A booking can consist of one or more seats, depending on the number of passengers.

Approval
Approval is the process by which a supplier validates and confirms a booking, making it officially valid. This step ensures that all necessary conditions are met and that the booking is accepted by the operator

Price / Gross Price
Price / Gross Price: Gross Price is the total cost of the itinerary for the end customer, including all markups, fees, and additional charges. It represents the final amount that the customer pays.

Cost / Net Price
Net Price is the base cost of the itinerary paid to the supplier, excluding any markups or additional fees. It represents the raw cost of providing the transportation service.

Booking
A booking is an instance representing the purchase of an itinerary by a customer. It includes all the details of the purchased itinerary and goes through various stages in its lifecycle, from initial intent to purchase, through confirmation, to the completion of travel. Bookings can include multiple passengers. Modifications and cancellations are handled at the booking level.

Lifecycle of Booking
The entire journey a reservation goes through, starting from the initial search by a customer to the final fulfillment of the booking. This includes searching for itineraries, returning itinerary details, creating the booking, booking confirmation, and returning the booking object by ID.

Booking Flow
The sequence of actions taken to complete a booking, including searching for itineraries, collecting passenger details, reserving the itinerary, processing payment, and finalizing the booking.

Booking Schema
Defines the structure and format of data required for making a booking. Depending on the providers, the schema may include different booking requirements, such as passengers’ ID number, date of birth, gender, age, seat selection, etc.

Webhook
A method for Travelier Connect to provide real-time updates to your application. Notifications are sent to a specified URL when certain events occur, such as booking status changes.

Mapping
The process of connecting and aligning data between different systems or formats, such as mapping station names, coordinates, and other important information to ensure consistency and compatibility across different platforms or systems.

Cutoff Time
The deadline by which a booking must be made. This is the latest possible time that a reservation can be confirmed before the departure of a service. For example, an operator might have a cutoff time of 24 hours before departure, meaning bookings must be completed at least one day prior to the travel date.

Lead Time
The period before a booking can be made. Lead time defines how far in advance a booking can be initiated. Some operators set specific lead times, such as allowing bookings to be made up to three months in advance but not beyond. This sets limitations on how far ahead of the travel date reservations can be confirmed.