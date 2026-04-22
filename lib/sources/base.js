/**
 * Data source interface. Every source (easyship, navlungo, shipentegra,
 * email-forwarding, mock) implements this contract so the core hub stays
 * source-agnostic.
 */
class DataSource {
  constructor(config) {
    this.config = config;
  }

  // Returns { orders: [...], stores: [...] } — normalized shape.
  // Each order must have: external_order_id, store_external_id, buyer_name,
  // ship_address (object), total_amount, currency, items (array), received_at
  async fetchNewOrders(sinceIso) {
    throw new Error('fetchNewOrders not implemented');
  }

  async pushTracking(externalOrderId, carrier, trackingNumber) {
    throw new Error('pushTracking not implemented');
  }
}

module.exports = { DataSource };
