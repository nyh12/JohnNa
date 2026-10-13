/**
 * Sample catalogue for local development and demos (no network access).
 * Prices are illustrative only (member price; non-member = +5% like S&R).
 */
const SAMPLE = [
  ['Kirkland Signature Mixed Nuts 1.13kg', 'Kirkland Signature', 'Food', 1199],
  ['Kirkland Signature Almonds 1.36kg', 'Kirkland Signature', 'Food', 1349],
  ['Members Selection Extra Virgin Olive Oil 2L', "Member's Selection", 'Food', 1099],
  ['Nutella Hazelnut Spread 1kg', 'Nutella', 'Food', 549],
  ['Ferrero Rocher 48pcs', 'Ferrero', 'Food', 1199],
  ['Quaker Oats Old Fashioned 4.52kg', 'Quaker', 'Food', 899],
  ['Kirkland Signature Colombian Coffee 1.36kg', 'Kirkland Signature', 'Beverages', 1249],
  ['Starbucks House Blend Whole Bean 1.13kg', 'Starbucks', 'Beverages', 1399],
  ['Coca-Cola Zero 330ml x 24', 'Coca-Cola', 'Beverages', 699],
  ['Kirkland Signature Bath Tissue 30 rolls', 'Kirkland Signature', 'Household', 1299],
  ['Kirkland Signature Paper Towels 12 rolls', 'Kirkland Signature', 'Household', 1149],
  ['Tide Ultra Detergent Pods 81ct', 'Tide', 'Household', 1299],
  ['Ziploc Freezer Bags Variety Pack', 'Ziploc', 'Household', 649],
  ['Kirkland Signature Baby Wipes 900ct', 'Kirkland Signature', 'Baby', 1449],
  ['Huggies Little Movers Size 4, 132ct', 'Huggies', 'Baby', 1899],
  ['Enfagrow A+ Four 2.4kg', 'Enfagrow', 'Baby', 2899],
  ['Kirkland Signature Daily Multi 500 tablets', 'Kirkland Signature', 'Health & Beauty', 1199],
  ['Centrum Silver Adults 50+ 275 tablets', 'Centrum', 'Health & Beauty', 1899],
  ['Cetaphil Moisturizing Cream 566g', 'Cetaphil', 'Health & Beauty', 899],
  ['Colgate Total Toothpaste 6 x 150g', 'Colgate', 'Health & Beauty', 599],
  ['Kirkland Signature Frozen Wild Salmon 1.36kg', 'Kirkland Signature', 'Frozen', 1599],
  ['Members Selection US Angus Ribeye per kg', "Member's Selection", 'Meat & Seafood', 2199],
  ['Tefal 5-piece Non-stick Cookware Set', 'Tefal', 'Home & Kitchen', 3499],
  ['Lock & Lock Food Container 12pc Set', 'Lock & Lock', 'Home & Kitchen', 1299],
];

async function* fetchProducts() {
  for (const [i, [name, brand, category, price]] of SAMPLE.entries()) {
    yield {
      sourceId: `MOCK-${String(i + 1).padStart(4, '0')}`,
      url: null,
      name,
      brand,
      category,
      description: `${name}. Sample product for development.`,
      image: null,
      price,
      regularPrice: Math.round(price * 105) / 100, // S&R non-member price is ~5% higher
      currency: 'PHP',
      inStock: i % 11 !== 5, // a couple of out-of-stock items
    };
  }
}

module.exports = { fetchProducts, SAMPLE };
