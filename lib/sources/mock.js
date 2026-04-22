const { DataSource } = require('./base');

// Mock source — generates fake orders for UI testing before real API key arrives.
class MockSource extends DataSource {
  async fetchNewOrders() {
    return { orders: [] }; // no new orders on poll; seed script loads initial data
  }

  async pushTracking(externalOrderId, carrier, trackingNumber) {
    return { stored: 'mock', externalOrderId, carrier, trackingNumber };
  }
}

module.exports = MockSource;
