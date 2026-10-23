// The email the studio opens with: a typical order confirmation, written the
// way production emails are (tables for layout, inline styles, a <style> block
// for mobile and dark mode). It loads nothing from the network.
//
// It is also meant to show the clients disagreeing: the dark-mode block,
// :hover, the mobile @media rule, system-ui and the flex delivery panel are
// each handled differently by at least one client.
export const SAMPLE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>Your Fernway order is confirmed</title>
    <style>
      .btn:hover { background: #166534 !important; }
      @media (max-width: 600px) {
        .container { width: 100% !important; }
        .px { padding-left: 20px !important; padding-right: 20px !important; }
      }
      @media (prefers-color-scheme: dark) {
        .bg { background: #0f1410 !important; }
        .card { background: #1a201b !important; }
        .panel { background: #232a24 !important; }
        .text { color: #e4e7e2 !important; }
        .muted { color: #9ca39b !important; }
      }
    </style>
  </head>
  <body class="bg" style="margin:0;background:#f3f4f1;font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
      Order #10423 is confirmed and ships within 2 business days.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:#f3f4f1">
      <tr><td align="center" style="padding:32px 12px">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0">
          <tr><td class="px text" style="padding:0 8px 20px;font-size:18px;font-weight:bold;color:#14532d">
            Fernway
          </td></tr>

          <tr><td class="card px" style="background:#ffffff;border-radius:12px;padding:36px 40px">
            <h1 class="text" style="margin:0 0 8px;font-size:24px;line-height:1.3;color:#1c2a1f">Your order is confirmed</h1>
            <p class="muted" style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#5b6659">
              Thanks for shopping with us. We'll email you again when order #10423 ships.
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px">
              <tr>
                <td class="text" style="padding:14px 0;border-top:1px solid #e6e9e4;color:#1c2a1f">Linen apron, olive <span class="muted" style="color:#5b6659">× 1</span></td>
                <td class="text" align="right" style="padding:14px 0;border-top:1px solid #e6e9e4;color:#1c2a1f">$48.00</td>
              </tr>
              <tr>
                <td class="text" style="padding:14px 0;border-top:1px solid #e6e9e4;color:#1c2a1f">Ceramic pour-over set <span class="muted" style="color:#5b6659">× 1</span></td>
                <td class="text" align="right" style="padding:14px 0;border-top:1px solid #e6e9e4;color:#1c2a1f">$64.00</td>
              </tr>
              <tr>
                <td class="muted" style="padding:14px 0 4px;border-top:1px solid #e6e9e4;font-size:14px;color:#5b6659">Shipping</td>
                <td class="muted" align="right" style="padding:14px 0 4px;border-top:1px solid #e6e9e4;font-size:14px;color:#5b6659">Free</td>
              </tr>
              <tr>
                <td class="text" style="padding:4px 0 0;font-weight:bold;color:#1c2a1f">Total</td>
                <td class="text" align="right" style="padding:4px 0 0;font-weight:bold;color:#1c2a1f">$112.00</td>
              </tr>
            </table>

            <div class="panel" style="display:flex;gap:16px;margin:28px 0;padding:16px 20px;background:#f3f6f2;border-radius:8px">
              <div style="flex:1">
                <p class="muted" style="margin:0 0 4px;font-size:12px;color:#5b6659">Shipping to</p>
                <p class="text" style="margin:0;font-size:14px;line-height:1.5;color:#1c2a1f">Sam Rivera<br>2140 Alder Street<br>Portland, OR 97214</p>
              </div>
              <div style="flex:1">
                <p class="muted" style="margin:0 0 4px;font-size:12px;color:#5b6659">Estimated delivery</p>
                <p class="text" style="margin:0;font-size:14px;line-height:1.5;color:#1c2a1f">Oct 30 – Nov 3</p>
              </div>
            </div>

            <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#15803d">
              <a class="btn" href="https://example.com/orders/10423" style="display:inline-block;padding:13px 24px;border-radius:8px;background:#15803d;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">View your order</a>
            </td></tr></table>
          </td></tr>

          <tr><td class="px muted" style="padding:24px 8px;font-size:12px;line-height:1.6;color:#7a8578">
            Questions? Reply to this email or write to <a href="mailto:help@example.com" style="color:#15803d">help@example.com</a>.<br>
            Fernway · 118 Market Street · Portland, OR 97204
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
