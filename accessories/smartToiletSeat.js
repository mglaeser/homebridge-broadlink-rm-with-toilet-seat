const SwitchAccessory = require('./switch');

class SmartToiletSeat extends SwitchAccessory {
  
  constructor(log, config = {}) {
    // Keep the original config as-is for validation
    // The conversion will happen later in the switch logic
    super(log, config);
  }

  serviceType() {
    return Service.Switch;
  }

  // Override performSend to handle numeric hex codes
  async performSend(data, actionCallback) {
    const { debug, config, host, log, name } = this;

    // Convert numeric to string if needed
    if (typeof data === 'number') {
      data = data.toString();
    }

    // Call parent method with converted data
    return super.performSend(data, actionCallback);
  }

  // Override the method that gets hex data to convert numbers to strings
  async setSwitchState(hexData) {
    // Convert numeric hex code to string
    if (typeof hexData === 'number') {
      hexData = hexData.toString();
    }
    
    // Call parent method
    return super.setSwitchState(hexData);
  }

  configureServiceManager(serviceManager) {
    const { data } = this;
    
    // Handle both data structures and convert numbers to strings at runtime
    let onData = data.powerOn || data.on;
    let offData = data.powerOff || data.off;
    
    // Convert to strings if they're numbers
    if (typeof onData === 'number') onData = onData.toString();
    if (typeof offData === 'number') offData = offData.toString();
    
    // Update the data object with converted values
    const convertedData = { ...data };
    if (convertedData.powerOn) convertedData.on = onData;
    if (convertedData.powerOff) convertedData.off = offData;
    if (!convertedData.on && onData) convertedData.on = onData;
    if (!convertedData.off && offData) convertedData.off = offData;
    
    // Temporarily replace this.data for the parent call
    const originalData = this.data;
    this.data = convertedData;
    
    // Call parent method
    super.configureServiceManager(serviceManager);
    
    // Restore original data
    this.data = originalData;
  }
}

module.exports = SmartToiletSeat;