const SwitchAccessory = require('./switch');

class SmartToiletSeat extends SwitchAccessory {

  serviceType() { return Service.Switch }

  constructor(log, config = {}) {
    // Ensure required properties
    if (!config.name) config.name = "Smart Toilet Seat";
    
    // Convert numeric hex codes to strings before passing to parent
    const convertedConfig = SmartToiletSeat.convertHexCodes(config);
    
    super(log, convertedConfig);
    
    this.checkConfig(config);
  }

  static convertHexCodes(config) {
    const converted = { ...config };
    if (converted.data) {
      converted.data = { ...converted.data };
      // Convert all numeric values to strings
      Object.keys(converted.data).forEach(key => {
        if (typeof converted.data[key] === 'number') {
          converted.data[key] = converted.data[key].toString();
        }
      });
      
      // Map powerOn/powerOff to on/off for compatibility with SwitchAccessory
      if (converted.data.powerOn && !converted.data.on) {
        converted.data.on = converted.data.powerOn;
      }
      if (converted.data.powerOff && !converted.data.off) {
        converted.data.off = converted.data.powerOff;
      }
    }
    return converted;
  }

  checkConfig(config) {
    const { data } = config;
    if (!data) {
      this.log(`${config.name} checkConfig: No data found in config`);
      return;
    }

    // List only the required hex codes
    const requiredCodes = [
      'powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff',
      'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'dryOn', 'dryOff'
    ];

    const missingCodes = requiredCodes.filter(code => !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${config.name} checkConfig: Missing hex codes: ${missingCodes.join(', ')}`);
    } else {
      this.log(`${config.name} checkConfig: All required hex codes found`);
    }
  }

  setDefaults() {
    super.setDefaults();
    
    const { state } = this;

    // Only the 5 functions you need
    state.powerSaveState = false;
    state.showerActive = false;
    state.bidetActive = false;
    state.dryActive = false;
    
    // Auto-off timeouts for water functions
    this.autoOffTimeouts = {};
  }

  reset() {
    super.reset();

    // Clear all auto-off timeouts
    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  // Override performSend to ensure hex codes are strings
  async performSend(hexData) {
    if (typeof hexData === 'number') {
      hexData = hexData.toString();
    }
    return super.performSend(hexData);
  }

  // Water function with auto-off
  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `${functionType}Active`;
    const hexKey = `${functionType}${active ? 'On' : 'Off'}`;
    
    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.state[stateKey] = active;
      
      // Clear existing timeout
      if (this.autoOffTimeouts[functionType]) {
        clearTimeout(this.autoOffTimeouts[functionType]);
        delete this.autoOffTimeouts[functionType];
      }
      
      // Set auto-off for water functions (60 seconds)
      if (active) {
        log(`${name} ${functionType}: Auto-off in 60 seconds`);
        this.autoOffTimeouts[functionType] = setTimeout(async () => {
          this.state[stateKey] = false;
          await this.performSend(data[`${functionType}Off`]);
          this.serviceManager.refreshCharacteristicUI(Characteristic.Active);
          delete this.autoOffTimeouts[functionType];
        }, 60000);
      }
    }
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Main power switch (inherited from SwitchAccessory)
    super.configureServiceManager(serviceManager);

    // Power Save Switch - as a second On characteristic
    serviceManager.addToggleCharacteristic({
      name: 'powerSaveState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff,
        setValuePromise: async (hexData) => {
          if (hexData) await this.performSend(hexData);
        }
      }
    });

    // Shower Valve
    serviceManager.addToggleCharacteristic({
      name: 'showerActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: async (hexData, previousValue) => {
          const isActive = this.state.showerActive;
          await this.setWaterFunction('shower', isActive);
        }
      }
    });

    // Bidet Valve
    serviceManager.addToggleCharacteristic({
      name: 'bidetActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        setValuePromise: async (hexData, previousValue) => {
          const isActive = this.state.bidetActive;
          await this.setWaterFunction('bidet', isActive);
        }
      }
    });

    // Dry Function
    serviceManager.addToggleCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.dryOn,
        offData: data.dryOff,
        setValuePromise: async (hexData) => {
          if (hexData) await this.performSend(hexData);
        }
      }
    });
  }
}

module.exports = SmartToiletSeat;