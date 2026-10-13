// S&R shows "Member Price ₱ 565.00" and "Non-member Price: ₱ 593.25" on listings and product pages.
const AMOUNT = String.raw`\s*:?\s*(?:₱|PHP|Php|P)?\s*([\d,]+(?:\.\d{1,2})?)`;
const MEMBER_PRICE = new RegExp(String.raw`(?<!non[-\s]?)member'?s?\s*price` + AMOUNT, 'i');
const NON_MEMBER_PRICE = new RegExp(String.raw`non[-\s]?member'?s?\s*price` + AMOUNT, 'i');

module.exports = { MEMBER_PRICE, NON_MEMBER_PRICE };
