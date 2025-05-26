const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');
const ping = require('../helpers/ping')
const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeat extends BroadlinkRMAccessory {

  serviceType () { return Service.Switch }

  constructor (log, config = {}) {   
    super(log, config);

    // Don't set manufacturer/model to avoid log errors
    // this.manufacturer = 'Smart Toilet';
    // this.model = 'Smart Toilet Seat';
    // this.serialNumber = 'STS-001';

    // Convert all numeric hex codes to strings before the platform helper sees them
    this.convertConfigHexCodes(config);

    if (!config.isUnitTest) this.checkPing(ping)
  }

  // Convert numeric hex codes to strings to satisfy platform helper
  convertConfigHexCodes(config) {
    if (config.data) {
      Object.keys(config.data).forEach(key => {
        if (typeof config.data[key] === 'number') {
          config.data[key] = config.data[key].toString();
        }
      });
    }
  }

  setDefaults () {
    const { config } = this;
    config.pingFrequency = config.pingFrequency || 2;
    config.pingFrequency = Math.max(config.pingFrequency, 2);

    config.offDuration = config.offDuration || 60;
    config.onDuration = config.onDuration || 60;

    if (config.enableAutoOn === undefined && config.disableAutomaticOn === undefined) {
      config.enableAutoOn = false;
    } else if (config.disableAutomaticOn !== undefined) {
      config.enableAutoOn = !config.disableAutomaticOn;
    }

    if (config.enableAutoOff === undefined && config.disableAutomaticOff === undefined) {
      config.enableAutoOff = false;
    } else if (config.disableAutomaticOff !== undefined) {
      config.enableAutoOff = !config.disableAutomaticOff;
    }
  }

  reset () {
    super.reset();

    // Clear Timeouts
    if (this.delayTimeoutPromise) {
      this.delayTimeoutPromise.cancel();
      this.delayTimeoutPromise = null;
    }

    if (this.autoOffTimeoutPromise) {
      this.autoOffTimeoutPromise.cancel();
      this.autoOffTimeoutPromise = null;
    }

    if (this.autoOnTimeoutPromise) {
      this.autoOnTimeoutPromise.cancel();
      this.autoOnTimeoutPromise = null
    }
  }

  checkAutoOnOff () {
    this.reset();
    this.checkAutoOn();
    this.checkAutoOff();
  }
  
  checkPing (ping) {
    const { config } = this
    let { pingIPAddress, pingFrequency } = config;

    if (!pingIPAddress) return
    
    // Setup Ping-based State
    ping(pingIPAddress, pingFrequency, this.pingCallback.bind(this))
  }

  pingCallback (active) {
    let { debug, config, log, name, state, serviceManager } = this;
    debug = true

    const previousState = state.switchState
    const newState = active ? true : false;

    // Only update Homkit if the switch state haven changed.
    const hasStateChanged = (previousState === newState)
    if (debug) log(`${name} pingCallback: state ${hasStateChanged ? 'not changed, ignoring' : 'changed'} (device ${newState ? 'active' : 'inactive'})`);

    if (hasStateChanged) return

    if (config.pingIPAddressStateOnly) {
      if (debug) log(`${name} pingCallback: UI updated only`);

      state.switchState = newState

      serviceManager.refreshCharacteristicUI(Characteristic.On);

      return;
    }
    
    if (debug) log(`${name} pingCallback: UI updated and command sent`);

    serviceManager.setCharacteristic(Characteristic.On, newState);
  }

  async setSwitchState (hexData) {
    const { data, host, log, name, debug } = this;

    this.reset();

    // Remove the convertHexData call since conversion happens in constructor
    if (hexData) await this.performSend(hexData);

    this.checkAutoOnOff();
  }

  async checkAutoOff () {
    await catchDelayCancelError(async () => {
      const { config, log, name, state, serviceManager } = this;
      let { disableAutomaticOff, enableAutoOff, onDuration } = config;

      if (state.switchState && enableAutoOff) {
        log(`${name} setSwitchState: (automatically turn off in ${onDuration} seconds)`);

        this.autoOffTimeoutPromise = delayForDuration(onDuration);
        await this.autoOffTimeoutPromise;

        serviceManager.setCharacteristic(Characteristic.On, false);
      }
    });
  }

  async checkAutoOn () {
    await catchDelayCancelError(async () => {
      const { config, log, name, state, serviceManager } = this;
      let { disableAutomaticOn, enableAutoOn, offDuration } = config;

      if (!state.switchState && enableAutoOn) {
        log(`${name} setSwitchState: (automatically turn on in ${offDuration} seconds)`);

        this.autoOnTimeoutPromise = delayForDuration(offDuration);
        await this.autoOnTimeoutPromise;

        serviceManager.setCharacteristic(Characteristic.On, true);
      }
    });
  }

  configureServiceManager (serviceManager) {
    const { data } = this;
    
    // Handle both data structures
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