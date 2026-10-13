const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListingPage, discoverCategories, countMemberLabels } = require('../src/scraper/snr');

// Shaped like a snrshopping.com category listing: product cards showing
// "Member Price ₱ X" and "Non-member Price: ₱ Y".
const LISTING = `<html><body>
  <header><nav>
    <a href="/">Home</a>
    <a href="/category/grocery">Grocery</a>
    <a href="https://www.snrshopping.com/category/members-value">Member's Value</a>
    <a href="/page/contact-us">Contact</a>
  </nav></header>
  <main>
    <h1>Grocery</h1>
    <div class="products">
      <div class="product-item">
        <a href="/kirkland-signature-mixed-nuts-1-13kg"><img data-src="/media/nuts.jpg" src="data:image/gif;base64,R0lGOD" alt="Kirkland Mixed Nuts"></a>
        <div class="product-name"><a href="/kirkland-signature-mixed-nuts-1-13kg">Kirkland Signature Mixed Nuts 1.13kg</a></div>
        <div class="price"><span>Member Price</span> <strong>₱ 1,199.00</strong></div>
        <div class="nm-price">Non-member Price: ₱ 1,258.95</div>
        <small>Save as a member!</small>
        <button data-product-id="10234">Add to cart</button>
      </div>
      <div class="product-item">
        <a href="/wolf-blass-bilyara-shiraz-2022-750ml"><img src="https://cdn.snrshopping.com/wine.jpg" alt="Wine"></a>
        <h3>Wolf Blass Bilyara Shiraz 2022 750mL</h3>
        <p>Member Price ₱ 499.00</p>
        <p>Non-member Price: ₱ 523.95</p>
        <span>Out of stock</span>
      </div>
    </div>
    <ul class="pagination">
      <li><a href="/category/grocery?page=1">1</a></li>
      <li><a href="/category/grocery?page=2">2</a></li>
      <li><a href="/category/other?page=2">x</a></li>
    </ul>
  </main>
</body></html>`;

test('discovers /category/ links on the home page', () => {
  assert.deepEqual(discoverCategories(LISTING, 'https://www.snrshopping.com'), [
    'https://www.snrshopping.com/category/grocery',
    'https://www.snrshopping.com/category/members-value',
    'https://www.snrshopping.com/category/other',
  ]);
});

test('parses product cards with member and non-member prices', () => {
  const page = parseListingPage(LISTING, 'https://www.snrshopping.com/category/grocery');
  assert.equal(page.title, 'Grocery');
  assert.equal(page.products.length, 2);

  const [nuts, wine] = page.products;
  assert.deepEqual(nuts, {
    sourceId: '10234',
    url: 'https://www.snrshopping.com/kirkland-signature-mixed-nuts-1-13kg',
    name: 'Kirkland Signature Mixed Nuts 1.13kg',
    brand: null,
    description: null,
    image: 'https://www.snrshopping.com/media/nuts.jpg',
    price: 1199,
    regularPrice: 1258.95,
    currency: 'PHP',
    inStock: true,
  });
  assert.equal(wine.name, 'Wolf Blass Bilyara Shiraz 2022 750mL');
  assert.equal(wine.price, 499);
  assert.equal(wine.regularPrice, 523.95);
  assert.equal(wine.inStock, false);
  assert.equal(wine.sourceId, '/wolf-blass-bilyara-shiraz-2022-750ml');
  assert.equal(wine.image, 'https://cdn.snrshopping.com/wine.jpg');
});

test('follows pagination of the same category only', () => {
  const page = parseListingPage(LISTING, 'https://www.snrshopping.com/category/grocery?page=1');
  assert.deepEqual(page.nextPages, ['https://www.snrshopping.com/category/grocery?page=2']);
});

test('a lone product on a page does not swallow page chrome', () => {
  const html = `<body><header><nav><a href="/category/a">A</a></nav></header><main><h1>Search</h1>
    <div class="grid"><div class="card"><a href="/thing">Thing 1L</a><span>Member Price ₱ 100.00</span></div></div></main></body>`;
  const { products } = parseListingPage(html, 'https://www.snrshopping.com/search');
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Thing 1L');
  assert.equal(products[0].url, 'https://www.snrshopping.com/thing');
});

test('counts member labels but not non-member labels', () => {
  assert.equal(countMemberLabels('Member Price ₱1 Non-member Price: ₱2'), 1);
  assert.equal(countMemberLabels('Non-Member Price'), 0);
});
