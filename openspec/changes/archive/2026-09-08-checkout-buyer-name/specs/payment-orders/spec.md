# Delta for Payment Orders

## MODIFIED Requirements

### Requirement: R2: POST /api/payment/create-order

The endpoint MUST accept a Zod-validated body, call `POST https://api.culqi.com/v2/orders`, persist the response, and return payment instructions.

Input: `{ amount (number, céntimos), currency (default PEN), email (email), phone (optional), businessId (UUID), productId (optional UUID), customerName (optional), description (optional) }`.

The Culqi order body MUST include: `amount`, `currency_code`, `description`, `order_number` (generated), `client_details`, `expiration_date` (now + 3 days), `confirm: false`. When `customerName` is present, `client_details` SHALL include `first_name` and `last_name` derived via `splitFullName(customerName)`; when absent, `client_details` SHALL NOT include name keys.
(Previously: `client_details` carried only `{ email, phone }` and never included buyer name keys)

#### Scenario: Successful order — PagoEfectivo returns CIP

- GIVEN valid input including `amount: 5000`, `email: buyer@test.com`
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return `{ success: true, culqiOrderId, paymentCode, qrUrl, expirationDate }`
- AND `payment_orders` MUST have a row with `status: pending`, `paymentMethod` matching the Culqi response

#### Scenario: Successful order includes buyer name

- GIVEN valid input including `customerName: "Juan Perez"`
- WHEN `POST /api/payment/create-order` is called
- THEN `client_details` MUST include `first_name: "Juan"` and `last_name: "Perez"`

#### Scenario: Order without buyer name omits name keys

- GIVEN valid input without `customerName`
- WHEN `POST /api/payment/create-order` is called
- THEN `client_details` MUST NOT include `first_name` or `last_name`

#### Scenario: Invalid input rejected

- GIVEN a request with missing `businessId` or invalid `email`
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return HTTP 400 with a Zod validation error

#### Scenario: Culqi API failure

- GIVEN a valid request but Culqi returns a non-2xx response
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return the Culqi error details
- AND MUST NOT persist any `payment_orders` row