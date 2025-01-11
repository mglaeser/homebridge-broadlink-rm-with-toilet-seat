const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  serviceType() {
    return Service.Switch;
  }

  constructor(log, config = {}) {
    super(log, config);
    
    // Initialize state
    this.state = {
      switchState: false,
      powerSaveState: false,
      dryState: false,
      rotationSpeed: 0,
      valveShowerState: false,
      valveBidetState: false,
      valveMassageState: false,
      seatCurrentTemperature: 35,
      seatTargetTemperature: 35,
      waterCurrentTemperature: 35,
      waterTargetTemperature: 35
    };

    this.lastUsedTemp = {}; // Track last used temperatures
  }

  // Required methods for Base
  async setSwitchState(hexData, previousValue) {
    const { name, state } = this;
    
    // Ignore if no change
    if (state.switchState === previousValue) return;

    this.log(`${name} setSwitchState: ${state.switchState}`);
    await this.performSend(hexData);
  }

  async setRotationSpeed(hexData, previousValue) {
    const { data, name, state } = this;
    const speed = state.rotationSpeed;
    let hexDataToSend;

    if (speed <= 33) hexDataToSend = data.fanSpeed10;
    else if (speed <= 66) hexDataToSend = data.fanSpeed50;
    else hexDataToSend = data.fanSpeed100;

    if (hexDataToSend) {
      this.log(`${name} setRotationSpeed: ${speed}%`);
      await this.performSend(hexDataToSend);
    }
  }

  async setTemperature(hexData, previousValue, type) {
    const { name, state } = this;
    const targetKey = `${type}TargetTemperature`;
    const currentKey = `${type}CurrentTemperature`;
    
    if (!this.lastUsedTemp[type]) {
      this.lastUsedTemp[type] = state[targetKey];
    }

    const targetTemp = state[targetKey];
    if (targetTemp > this.lastUsedTemp[type]) {
      await this.performSend(this.data[`${type}TempUp`]);
    } else if (targetTemp < this.lastUsedTemp[type]) {
      await this.performSend(this.data[`${type}TempDown`]);
    }

    this.lastUsedTemp[type] = targetTemp;
    state[currentKey] = targetTemp;
    
    this.log(`${name} setTemperature ${type}: ${targetTemp}°C`);
  }

  getCharacteristicValue(characteristicName, callback) {
    const { state } = this;
    
    switch(characteristicName) {
      case 'switchState':
      case 'powerSaveState':
      case 'dryState':
      case 'valveShowerState':
      case 'valveBidetState':
      case 'valveMassageState':
        callback(null, state[characteristicName] || false);
        break;
        
      case 'rotationSpeed':
        callback(null, state.rotationSpeed || 0);
        break;
        
      case 'seatCurrentTemperature':
      case 'seatTargetTemperature':
      case 'waterCurrentTemperature':
      case 'waterTargetTemperature':
        callback(null, state[characteristicName] || 35);
        break;
        
      default:
        callback(null, false);
    }
  }

  setCharacteristicValue(characteristicName, value, callback) {
    const { state } = this;
    
    state[characteristicName] = value;
    callback();
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // Power Switch
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue.bind(this),
      setMethod: this.setCharacteristicValue.bind(this),
      bind: this,
      props: {
        onData: data.powerOn,
        offData: data.powerOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Power Save
    serviceManager.addToggleCharacteristic({
      name: 'powerSaveState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue.bind(this),
      setMethod: this.setCharacteristicValue.bind(this),
      bind: this,
      props: {
        onData: data.powerSaveOn,
        offData: data.powerSaveOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Dry Function
    serviceManager.addToggleCharacteristic({
      name: 'dryState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue.bind(this),
      setMethod: this.setCharacteristicValue.bind(this),
      bind: this,
      props: {
        onData: data.dryOn,
        offData: data.dryOff,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });

    // Dry Speed
    serviceManager.addToggleCharacteristic({
      name: 'rotationSpeed',
      type: Characteristic.RotationSpeed,
      getMethod: this.getCharacteristicValue.bind(this),
      setMethod: this.setCharacteristicValue.bind(this),
      bind: this,
      props: {
        setValuePromise: this.setRotationSpeed.bind(this)
      }
    });

    // Valves (Shower, Bidet, Massage)
    ['Shower', 'Bidet', 'Massage'].forEach(valveType => {
      const lcType = valveType.toLowerCase();
      serviceManager.addToggleCharacteristic({
        name: `valve${valveType}State`,
        type: Characteristic.Active,
        getMethod: this.getCharacteristicValue.bind(this),
        setMethod: this.setCharacteristicValue.bind(this),
        bind: this,
        props: {
          onData: data[`${lcType}On`],
          offData: data[`${lcType}Off`],
          setValuePromise: this.setSwitchState.bind(this)
        }
      });
    });

    // Temperatures (Seat and Water)
    ['seat', 'water'].forEach(type => {
      // Current Temperature
      serviceManager.addToggleCharacteristic({
        name: `${type}CurrentTemperature`,
        type: Characteristic.CurrentTemperature,
        getMethod: this.getCharacteristicValue.bind(this),
        setMethod: this.setCharacteristicValue.bind(this),
        bind: this
      });

      // Target Temperature
      serviceManager.addToggleCharacteristic({
        name: `${type}TargetTemperature`,
        type: Characteristic.TargetTemperature,
        getMethod: this.getCharacteristicValue.bind(this),
        setMethod: this.setCharacteristicValue.bind(this),
        bind: this,
        props: {
          setValuePromise: (hexData, prevValue) => this.setTemperature(hexData, prevValue, type)
        }
      });
    });
  }
}

module.exports = SmartToiletSeat;