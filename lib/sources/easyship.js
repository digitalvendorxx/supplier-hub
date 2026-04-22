const { DataSource } = require('./base');

/**
 * Easyship data source — fetches orders from Easyship API.
 * Docs: https://developers.easyship.com/
 *
 * Auth: Bearer token from Easyship dashboard (Connect → API Integration).
 * Endpoint used: GET /2023-01/shipments (orders imported from Etsy show here).
 */
class EasyshipSource extends DataSource {
  constructor(config) {
    super(config);
    this.token = config.EASYSHIP_API_TOKEN;
    this.base = config.EASYSHIP_API_BASE || 'https://public-api.easyship.com';
    if (!this.token) {
      throw new Error('EASYSHIP_API_TOKEN is not set in .env');
    }
  }

  async _request(pathname, params = {}) {
    const url = new URL(this.base + pathname);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Easyship ${res.status}: ${text}`);
    }
    return res.json();
  }

  async fetchNewOrders(sinceIso) {
    // Easyship public API shipments endpoint
    // Docs: https://developers.easyship.com/reference/shipments_index
    const data = await this._request('/2024-09/shipments', {
      created_at_from: sinceIso,
      per_page: 100,
    });

    const shipments = data.shipments || [];
    const orders = shipments.map((s) => ({
      external_order_id: s.platform_order_number || s.easyship_shipment_id,
      easyship_shipment_id: s.easyship_shipment_id,
      store_external_id: (s.platform_name || 'etsy') + ':' + (s.store_name || 'unknown'),
      store_name: s.store_name,
      source: 'easyship',
      buyer_name: s.destination_address?.contact_name,
      buyer_email: s.destination_address?.contact_email,
      ship_address: {
        name: s.destination_address?.contact_name,
        address1: s.destination_address?.line_1,
        address2: s.destination_address?.line_2,
        city: s.destination_address?.city,
        state: s.destination_address?.state,
        postal: s.destination_address?.postal_code,
        country: s.destination_address?.country_alpha2,
      },
      total_amount: s.total_actual_weight || 0,
      currency: s.currency || 'USD',
      items: (s.parcels || []).flatMap((p) =>
        (p.items || []).map((i) => ({
          sku: i.sku,
          title: i.description,
          quantity: i.quantity,
          price: i.declared_customs_value,
        })),
      ),
      received_at: s.created_at,
      raw: s,
    }));

    return { orders };
  }

  async pushTracking(easyshipShipmentId, carrier, trackingNumber) {
    // Push tracking number to Easyship. Easyship then syncs this back to
    // Etsy automatically (via the connected Etsy integration), which marks
    // the order as shipped and notifies the buyer.
    // Requires scope: public.shipment:write
    const res = await fetch(`${this.base}/2024-09/shipments/${easyshipShipmentId}/mark_as_shipped`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracking_number: trackingNumber,
        courier_name: carrier,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Easyship tracking push ${res.status}: ${text}`);
    }
    return res.json();
  }
}

module.exports = EasyshipSource;
