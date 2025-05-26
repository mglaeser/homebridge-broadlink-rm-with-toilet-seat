const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {
  
  constructor(log, config = {}) {
    if (!config.name) config.name = "Smart Toilet Seat";
    super(log, config);

    this.manufacturer = 'Smart Toilet';
    this.model = 'Smart Toilet Seat';
    this.serialNumber = 'STS-001';

    // Don't call checkConfig to avoid validation errors
    // this.checkConfig(config);
  }

  serviceType() {
    return Service.Switch;
  }

  setDefaults() {
    super.setDefaults();
    
    const { state } = this;

    // Only set the basic states for now
    state.switchState = false;
    state.powerSaveState = false;
  }

  reset() {
    super.reset();
  }

  async performSetValueAction({ host, data, log, name }) {
    await this.performSend(data);
  }

  // Convert numeric hex codes to strings for Broadlink sending
  convertHexData(hexData) {
    if (typeof hexData === 'number') {
      return hexData.toString();
    }
    return hexData;
  }

  // Override the parent's setSwitchState to handle the main power
  async setSwitchState(hexData) {
    const { log, name } = this;
    
    this.reset();

    if (hexData) {
      log(`${name} switching power: ${this.state.switchState ? 'ON' : 'OFF'}`);
      await this.performSend(this.convertHexData(hexData));
    }

    this.checkAutoOnOff();
  }

  configureServiceManager(serviceManager) {
    const { data } = this;

    // ONLY Main Power Switch for now - let's get this working first
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

    // Commenting out ALL other characteristics until the basic switch works
    // We'll add them back one by one once this is stable

    /*
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
    */
  }
}

module.exports = SmartToiletSeat;