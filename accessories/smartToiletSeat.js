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

    // List expected hex codes
    const expectedCodes = [
      'powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff',
      'dryOn', 'dryOff', 'rotationSpeedLow', 'rotationSpeedMedium', 'rotationSpeedHigh',
      'showerOn', 'showerOff', 'bidetOn', 'bidetOff', 'massageOn', 'massageOff',
      'seatTempUp', 'seatTempDown', 'showerTempUp', 'showerTempDown'
    ];

    const missingCodes = expectedCodes.filter(code => !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${config.name} checkConfig: Missing hex codes: ${missingCodes.join(', ')}`);
    }
  }

  setDefaults() {
    super.setDefaults();
    
    const { state } = this;

    // Main power states
    state.switchState = false;
    state.powerSaveState = false;
    
    // Dry function states
    state.dryActive = false;
    state.dryRotationSpeed = 0;
    
    // Water function states (valves)
    state.valveShowerActive = false;
    state.valveBidetActive = false;
    state.valveMassageActive = false;
    
    // Temperature states
    state.seatCurrentTemperature = 25;
    state.seatTargetTemperature = 25;
    state.showerCurrentTemperature = 25;
    state.showerTargetTemperature = 25;
    
    // Temperature display units (0 = Celsius)
    state.seatDisplayUnits = 0;
    state.showerDisplayUnits = 0;

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

  // Temperature control helper
  async adjustTemperature(type, direction) {
    const { data } = this;
    const tempKey = `${type}TargetTemperature`;
    const currentKey = `${type}CurrentTemperature`;
    const hexKey = `${type}Temp${direction === 'up' ? 'Up' : 'Down'}`;
    
    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      
      // Simulate temperature change
      const change = direction === 'up' ? 1 : -1;
      const newTemp = Math.max(10, Math.min(50, this.state[tempKey] + change));
      this.state[tempKey] = newTemp;
      this.state[currentKey] = newTemp;
      
      // Update UI
      this.serviceManager.refreshCharacteristicUI(
        type === 'seat' ? 'SeatTargetTemperature' : 'ShowerTargetTemperature'
      );
      this.serviceManager.refreshCharacteristicUI(
        type === 'seat' ? 'SeatCurrentTemperature' : 'ShowerCurrentTemperature'
      );
    }
  }

  // Water function with auto-off
  async setWaterFunction(functionType, active) {
    const { data, log, name } = this;
    const stateKey = `valve${functionType}Active`;
    const hexKey = `${functionType.toLowerCase()}${active ? 'On' : 'Off'}`;
    
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
          await this.performSend(data[`${functionType.toLowerCase()}Off`]);
          this.serviceManager.refreshCharacteristicUI(`Valve${functionType}Active`);
          delete this.autoOffTimeouts[functionType];
        }, 60000);
      }
    }
  }

  // Dry rotation speed control
  async setDryRotationSpeed(speed) {
    const { data } = this;
    let hexKey;
    
    if (speed <= 33) {
      hexKey = 'rotationSpeedLow';
    } else if (speed <= 66) {
      hexKey = 'rotationSpeedMedium';
    } else {
      hexKey = 'rotationSpeedHigh';
    }
    
    if (data[hexKey]) {
      await this.performSend(data[hexKey]);
      this.state.dryRotationSpeed = speed;
    }
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Main power switch (inherits from SwitchAccessory)
    super.configureServiceManager(serviceManager);

    // Power Save Switch
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

    // Dry Function Active
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

    // Dry Rotation Speed
    if (data.rotationSpeedLow || data.rotationSpeedMedium || data.rotationSpeedHigh) {
      serviceManager.addToggleCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          setValuePromise: this.setDryRotationSpeed.bind(this)
        }
      });
    }

    // Water Functions (Shower, Bidet, Massage)
    ['Shower', 'Bidet', 'Massage'].forEach((functionType) => {
      const stateKey = `valve${functionType}Active`;
      
      serviceManager.addToggleCharacteristic({
        name: stateKey,
        type: Characteristic.Active,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          setValuePromise: async (hexData, previousValue) => {
            const isActive = this.state[stateKey];
            await this.setWaterFunction(functionType, isActive);
          }
        }
      });
    });

    // Temperature Controls
    ['seat', 'shower'].forEach(type => {
      const currentTempKey = `${type}CurrentTemperature`;
      const targetTempKey = `${type}TargetTemperature`;
      const displayUnitsKey = `${type}DisplayUnits`;

      // Current Temperature (read-only)
      serviceManager.addToggleCharacteristic({
        name: currentTempKey,
        type: Characteristic.CurrentTemperature,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 0.5
        }
      });

      // Target Temperature (controllable)
      serviceManager.addToggleCharacteristic({
        name: targetTempKey,
        type: Characteristic.TargetTemperature,
        getMethod: this.getCharacteristicValue,
        setMethod: this.setCharacteristicValue,
        bind: this,
        props: {
          minValue: 10,
          maxValue: 50,
          minStep: 1,
          setValuePromise: async (hexData, previousValue) => {
            const currentTemp = this.state[currentTempKey];
            const targetTemp = this.state[targetTempKey];

            if (targetTemp > currentTemp) {
              await this.adjustTemperature(type, 'up');
            } else if (targetTemp < currentTemp) {
              await this.adjustTemperature(type, 'down');
            }
          }
        }
      });

      // Temperature Display Units
      serviceManager.addToggleCharacteristic({
        name: displayUnitsKey,
        type: Characteristic.TemperatureDisplayUnits,
        getMethod: (callback) => callback(null, 0), // 0 = Celsius
        setMethod: (value, callback) => callback(),
        bind: this
      });
    });
  }
}

module.exports = SmartToiletSeat;