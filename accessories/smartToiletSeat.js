const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  
  constructor(log, config = {}) {
    if (!config.name) config.name = "Smart Toilet Seat";
    super(log, config);

    this.manufacturer = 'Smart Toilet';
    this.model = 'Smart Toilet Seat';
    this.serialNumber = 'STS-001';

    this.checkConfig(config);
  }

  serviceType() {
    return Service.Switch;
  }

  setDefaults() {
    super.setDefaults();
    
    const { state } = this;

    state.switchState = false;
    state.powerSaveState = false;
    state.dryActive = false;
    state.dryRotationSpeed = 0;
    state.valveShowerActive = false;
    state.valveBidetActive = false;
    state.valveMassageActive = false;
    state.seatCurrentTemperature = 35;
    state.seatTargetTemperature = 35;
    state.showerCurrentTemperature = 35;
    state.showerTargetTemperature = 35;

    this.autoOffTimeouts = {};
  }

  reset() {
    super.reset();

    Object.values(this.autoOffTimeouts).forEach(timeout => {
      if (timeout) clearTimeout(timeout);
    });
    this.autoOffTimeouts = {};
  }

  async performSetValueAction({ host, data, log, name }) {
    await this.performSend(data);
  }

  // Override the parent's setSwitchState to handle the main power
  async setSwitchState(hexData) {
    const { log, name } = this;
    
    this.reset();

    if (hexData) {
      log(`${name} switching power: ${this.state.switchState ? 'ON' : 'OFF'}`);
      await this.performSend(hexData);
    }

    this.checkAutoOnOff();
  }

  // Custom handlers for different functions
  async setDryActive(value, callback) {
    const { data, log, name } = this;
    
    this.state.dryActive = value;
    const hexData = value ? data.dryOn : data.dryOff;
    
    if (hexData) {
      log(`${name} dry function: ${value ? 'ON' : 'OFF'}`);
      await this.performSend(hexData);
    }
    
    callback();
  }

  async setDryRotationSpeed(value, callback) {
    const { data, log, name } = this;
    
    this.state.dryRotationSpeed = value;
    
    let hexData;
    if (value <= 33) hexData = data.rotationSpeedLow;
    else if (value <= 66) hexData = data.rotationSpeedMedium;
    else hexData = data.rotationSpeedHigh;
    
    if (hexData) {
      log(`${name} dry speed: ${value}%`);
      await this.performSend(hexData);
    }
    
    callback();
  }

  async setValveActive(valveType, value, callback) {
    const { data, log, name, state, serviceManager } = this;
    const activeKey = `valve${valveType}Active`;
    const lcType = valveType.toLowerCase();
    
    state[activeKey] = value;
    const hexData = value ? data[`${lcType}On`] : data[`${lcType}Off`];
    
    if (hexData) {
      log(`${name} ${valveType} valve: ${value ? 'ON' : 'OFF'}`);
      await this.performSend(hexData);
    }
    
    // Handle auto-off for valves
    if (value) {
      if (this.autoOffTimeouts[valveType]) {
        clearTimeout(this.autoOffTimeouts[valveType]);
      }

      this.autoOffTimeouts[valveType] = setTimeout(async () => {
        state[activeKey] = false;
        serviceManager.refreshCharacteristicUI(Characteristic.Active);
        if (data[`${lcType}Off`]) {
          log(`${name} ${valveType} valve: AUTO OFF`);
          await this.performSend(data[`${lcType}Off`]);
        }
      }, 60000); // 60 seconds auto-off
    }
    
    callback();
  }

  async setTemperature(type, value, callback) {
    const { data, log, name, state } = this;
    const currentKey = `${type}CurrentTemperature`;
    const targetKey = `${type}TargetTemperature`;
    
    const current = state[currentKey];
    state[targetKey] = value;

    if (value > current) {
      if (data[`${type}TempUp`]) {
        log(`${name} ${type} temperature UP: ${value}°C`);
        await this.performSend(data[`${type}TempUp`]);
      }
    } else if (value < current) {
      if (data[`${type}TempDown`]) {
        log(`${name} ${type} temperature DOWN: ${value}°C`);
        await this.performSend(data[`${type}TempDown`]);
      }
    }

    state[currentKey] = value;
    callback();
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Main Power Switch
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerOn,
        offData: data.powerOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Power Save Mode
    serviceManager.addToggleCharacteristic({
      name: 'powerSaveState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff
      }
    });

    // Dry Function
    serviceManager.addGetCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      method: this.getCharacteristicValue,
      bind: this
    });

    serviceManager.addSetCharacteristic({
      name: 'dryActive',
      type: Characteristic.Active,
      method: this.setDryActive.bind(this)
    });

    // Dry Rotation Speed
    if (data.rotationSpeedLow || data.rotationSpeedMedium || data.rotationSpeedHigh) {
      serviceManager.addGetCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: 'dryRotationSpeed',
        type: Characteristic.RotationSpeed,
        method: this.setDryRotationSpeed.bind(this)
      });
    }

    // Valve Controls
    ['Shower', 'Bidet', 'Massage'].forEach((valveType) => {
      const activeKey = `valve${valveType}Active`;
      
      serviceManager.addGetCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: activeKey,
        type: Characteristic.Active,
        method: (value, callback) => this.setValveActive(valveType, value, callback)
      });
    });

    // Temperature Controls
    ['seat', 'shower'].forEach(type => {
      const currentKey = `${type}CurrentTemperature`;
      const targetKey = `${type}TargetTemperature`;

      // Current Temperature (read-only)
      serviceManager.addGetCharacteristic({
        name: currentKey,
        type: Characteristic.CurrentTemperature,
        method: this.getCharacteristicValue,
        bind: this
      });

      // Target Temperature (read/write)
      serviceManager.addGetCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        method: this.getCharacteristicValue,
        bind: this
      });

      serviceManager.addSetCharacteristic({
        name: targetKey,
        type: Characteristic.TargetTemperature,
        method: (value, callback) => this.setTemperature(type, value, callback)
      });

      // Temperature Display Units (always Celsius)
      serviceManager.addGetCharacteristic({
        name: `${type}DisplayUnits`,
        type: Characteristic.TemperatureDisplayUnits,
        method: (callback) => callback(null, 0) // 0 = Celsius
      });
    });
  }
}

module.exports = SmartToiletSeat;