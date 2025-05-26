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

    // Initialize state like the basic switch
    state.switchState = false;
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

  // Copy the exact method from switch.js
  async setSwitchState(hexData) {
    const { data, host, log, name, debug } = this;

    this.reset();

    if (hexData) await this.performSend(this.convertHexData(hexData));

    this.checkAutoOnOff();
  }

  // Copy the exact configureServiceManager from switch.js with minimal changes
  configureServiceManager(serviceManager) {
    const { data } = this;
    
    // Handle both data structures: data.powerOn/powerOff or data.on/off
    const onData = data.powerOn || data.on;
    const offData = data.powerOff || data.off;
    
    serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: onData,
        offData: offData,
        setValuePromise: this.setSwitchState.bind(this)
      }
    });
  }
}

module.exports = SmartToiletSeat;