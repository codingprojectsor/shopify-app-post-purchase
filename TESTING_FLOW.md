# UpsellHive - Testing Flow

> This guide assumes the app is already installed on your Shopify store and running. Start from Step 1 below to test all features.

---

## 1. Create a Test Upsell Offer

1. In the app dashboard, click **Create Offer**
2. Fill in the required fields:
   - **Title**: "Test Upsell"
   - **Product**: Use the resource picker to select a product from your dev store
   - **Discount type**: Percentage
   - **Discount value**: 20
   - **CTA text**: "Add to Order"
3. Leave targeting rules empty (so it matches all orders)
4. Set **Status** to **Active**
5. Click **Save**

**Verify:** The offer appears on the dashboard with status "Active".

---

## 2. Enable the Post-Purchase Extension

1. In your Shopify Admin, go to **Settings > Checkout**
2. Scroll to **Post-purchase page**
3. Enable **UpsellHive** (or "UpsellHive") as the post-purchase app
4. Save

> If the extension doesn't appear, run `shopify app dev` again and check the extension is building without errors in the terminal output.

---

## 3. Configure Widget Settings

1. In the app, go to **Widgets**
2. Ensure **Upsell Widget** is enabled
3. Optionally enable other widgets (Survey, Social Share, etc.)
4. Save the configuration

---

## 4. Place a Test Order

1. In your dev store, go to **Settings > Payments**
2. Enable **Shopify Payments (test mode)** or **Bogus Gateway**
3. Go to your storefront and add any product to cart
4. Proceed to checkout using test payment details:

   **For Bogus Gateway:**
   - Name: `Bogus Gateway`
   - Card number: `1` (for success)
   - CVV: `111`
   - Expiry: any future date

   **For Shopify Payments (test mode):**
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVV: any 3 digits

5. Complete the checkout

---

## 5. Test the Post-Purchase Upsell Flow

After completing checkout, you should see the **thank-you page** with the upsell offer.

### 5a. Test Accepting an Offer

1. The upsell widget should display your test product with the 20% discount
2. Click **"Add to Order"**
3. You should see an "Order Updated" confirmation

**Verify:**
- Go to **Orders** in Shopify Admin
- Open the test order
- Confirm the upsell product was added with the discount applied
- In the app dashboard, check that the offer shows 1 view and 1 accept

### 5b. Test Declining an Offer

1. Place another test order
2. On the thank-you page, click **"No thanks"** (or the decline button)
3. The upsell widget should disappear (or show a fallback offer if configured)

**Verify:**
- In the app dashboard, the offer shows an additional view and 1 decline

### 5c. Test Countdown Timer (if configured)

1. Edit your offer and set **Time Limit** to 1 minute
2. Place a test order
3. Watch the countdown timer on the thank-you page
4. Let it expire without clicking anything

**Verify:** The offer auto-declines when the timer reaches zero.

---

## 6. Test Targeting Rules

### Cart Value Targeting

1. Edit the offer, add a targeting rule:
   - Type: `cart_value`
   - Operator: `greater_than`
   - Value: `50`
2. Place an order with total **below** $50

**Verify:** No upsell offer appears on the thank-you page.

3. Place an order with total **above** $50

**Verify:** The upsell offer appears.

### Product-Based Targeting

1. Add a targeting rule:
   - Type: `product`
   - Operator: `contains`
   - Value: a specific product ID
2. Place an order **with** that product

**Verify:** Offer appears.

3. Place an order **without** that product

**Verify:** Offer does not appear.

---

## 7. Test Multi-Step Funnels (Fallback Offers)

1. Create **Offer A** (e.g., premium product, 10% off)
2. Create **Offer B** (e.g., accessory, 30% off)
3. Edit Offer A and set **Fallback Offer** to Offer B
4. Place a test order
5. Decline Offer A

**Verify:** Offer B appears immediately after declining Offer A.

---

## 8. Test A/B Testing

1. Go to **A/B Tests** in the app
2. Create a new test:
   - Control: Offer A
   - Variant: Offer B
   - Split: 50/50
3. Place multiple test orders (at least 4-6)

**Verify:**
- Roughly half the orders show Offer A, half show Offer B
- The A/B test dashboard tracks views/accepts per variant

---

## 9. Test Analytics

1. After placing several test orders (mix of accepts and declines)
2. Go to the **Analytics** page in the app
3. Check the date range covers today

**Verify:**
- Views, accepts, declines, and revenue numbers are correct
- Conversion rate calculates properly
- CSV export downloads with accurate data

---

## 10. Test Branding / Customization

1. Go to **Settings** in the app
2. Customize branding:
   - Change primary color
   - Change button style
   - Toggle trust badges on/off
3. Save and place a new test order

**Verify:** The upsell widget on the thank-you page reflects your branding changes.

---

## 11. Test Extension Settings (Theme Editor)

1. In Shopify Admin, go to **Online Store > Themes > Customize**
2. Navigate to the checkout/thank-you page customization
3. Find the UpsellHive block and adjust settings:
   - Button layout: side-by-side vs stacked
   - Decline text: custom wording
   - Hide decline button: toggle on/off
   - Accept tone: auto vs critical (red)
4. Save and place a test order

**Verify:** The thank-you page reflects the theme editor settings.

---

## 12. Test Survey Widget

1. In **Widgets**, enable the Survey widget
2. Add survey questions (e.g., "How did you hear about us?")
3. Place a test order

**Verify:**
- Survey appears on the thank-you page
- Submitting a response works
- Response appears in the app's survey data

---

## 13. Test Social Share Widget

1. In **Widgets**, enable Social Share
2. Place a test order

**Verify:** Twitter, Facebook, and WhatsApp share buttons appear and open correct share URLs.

---

## 14. Test App Uninstall & Reinstall

1. In Shopify Admin, go to **Settings > Apps and sales channels**
2. Remove UpsellHive
3. Reinstall the app from the dev URL

**Verify:**
- Uninstall webhook fires (check server logs)
- Session data is cleaned up
- Reinstalling works without errors
- Previous offers/data persists in the database (by design)

---

## 15. Test Error Scenarios

| Scenario | How to Test | Expected Result |
|---|---|---|
| Offer product deleted from store | Delete the product in Shopify, then trigger the offer | Offer skipped gracefully, no error shown to customer |
| Offer product out of stock | Set inventory to 0 | Offer may still show (depends on Shopify inventory policy) |
| Invalid discount value | Try saving an offer with discount > 100% | Validation error on save |
| Rate limiting | Send 31+ rapid requests to `/api/upsell/offer` | 429 Too Many Requests response |
| Expired JWT token | Manually test with an old token | 401 Unauthorized response |
| Network timeout | Throttle network in DevTools during offer load | Extension shows graceful fallback |

---

## 16. Test on Mobile

1. Open your dev store on a mobile browser (or use Chrome DevTools mobile emulation)
2. Complete a checkout
3. Check the thank-you page upsell widget

**Verify:** The upsell offer renders correctly on small screens with readable text and tappable buttons.
