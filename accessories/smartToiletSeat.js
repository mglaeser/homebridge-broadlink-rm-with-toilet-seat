const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {

  serviceType() { return Service.Switch } // Primary service

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
    }
    return converted;
  }

  checkConfig(config) {
    const { data } = config;
    if (!data) {
      this.log(`${config.name} checkConfig: No data found in config`);
      return;
    }

    // Check for the required hex codes
    const requiredCodes = ['powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff', 'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'dryOn', 'dryOff'];
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

    // State for all 5 functions
    state.powerState = false;          // Main power
    state.powerSaveState = false;      // Power save mode
    state.showerActive = false;        // Shower valve
    state.bidetActive = false;         // Bidet valve  
    state.dryActive = false;           // Dry function
    
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
          // Notify HomeKit of the change
          this.serviceManager.refreshCharacteristicUI(Characteristic.Active);
          delete this.autoOffTimeouts[functionType];
        }, 60000);
      }
    }
  }

  // Main power control
  async setPowerState(hexData) {
    const { data } = this;
    if (hexData) {
      await this.performSend(hexData);
    }
  }

  // Power save control  
  async setPowerSaveState(hexData) {
    const { data } = this;
    if (hexData) {
      await this.performSend(hexData);
    }
  }

  // Dry function control
  async setDryState(hexData) {
    const { data } = this;
    if (hexData) {
      await this.performSend(hexData);
    }
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Main Power Service (Switch)
    serviceManager.addToggleCharacteristic({
      name: 'powerState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerOn,
        offData: data.powerOff,
        setValuePromise: this.setPowerState.bind(this)
      }
    });

    // Power Save Service (Outlet)
    serviceManager.addToggleCharacteristic({
      name: 'powerSaveState', 
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff,
        setValuePromise: this.setPowerSaveState.bind(this),
        serviceType: Service.Outlet
      }
    });

    // Shower Valve Service
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
        },
        serviceType: Service.Valve
      }
    });

    // Bidet Valve Service
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
        },
        serviceType: Service.Valve
      }
    });

    // Dry Function Service (Fan)
    serviceManager.addToggleCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.dryOn,
        offData: data.dryOff,
        setValuePromise: this.setDryState.bind(this),
        serviceType: Service.Fan
      }
    });
  }
}

module.exports = SmartToiletSeat;