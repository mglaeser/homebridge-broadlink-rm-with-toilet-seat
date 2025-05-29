const ServiceManagerTypes = require('../helpers/serviceManagerTypes');
const delayForDuration = require('../helpers/delayForDuration');
const catchDelayCancelError = require('../helpers/catchDelayCancelError');
const BroadlinkRMAccessory = require('./accessory');

class SmartToiletSeatAccessory extends BroadlinkRMAccessory {

  constructor(log, config = {}, serviceManagerType) {
    // Set default name if not provided
    if (!config.name) config.name = "Smart Toilet Seat";

    super(log, config, serviceManagerType);

    // Initialize toilet-specific state
    this.toiletState = {
      powerSaveState: false,
      showerActive: false,
      bidetActive: false,
      dryActive: false
    };

    this.waterFunctionTimeouts = {};
  }

  setDefaults() {
    const { config } = this;
    
    // Set default auto-off duration for water functions
    config.waterFunctionDuration = config.waterFunctionDuration || 60;
    // Fix: Use dryDuration from config or default to dryFunctionDuration
    config.dryFunctionDuration = config.dryDuration || config.dryFunctionDuration || 60;
  }

  reset() {
    super.reset();

    // Clear all function timeouts
    Object.keys(this.waterFunctionTimeouts).forEach(key => {
      if (this.waterFunctionTimeouts[key]) {
        clearTimeout(this.waterFunctionTimeouts[key]);
        delete this.waterFunctionTimeouts[key];
      }
    });
  }

  // Main power switch
  async setPowerState(hexData, previousValue) {
    const { config, state, log, name } = this;
    
    if (hexData) {
      await this.performSend(hexData);
      log(`${name} Power: ${state.switchState ? 'ON' : 'OFF'}`);
    }
  }

  // Power save function
  async setPowerSaveState(hexData, previousValue) {
    const { config, log, name } = this;
    
    this.toiletState.powerSaveState = !previousValue;
    
    if (hexData) {
      await this.performSend(hexData);
      log(`${name} Power Save: ${this.toiletState.powerSaveState ? 'ON' : 'OFF'}`);
    }
  }

  // Water function handler (shower/bidet)
  async setWaterFunction(functionType, hexData, previousValue) {
    await catchDelayCancelError(async () => {
      const { config, log, name } = this;
      const stateKey = `${functionType}Active`;
      const isActive = !previousValue;
      
      this.toiletState[stateKey] = isActive;
      
      if (hexData) {
        await this.performSend(hexData);
        log(`${name} ${functionType.charAt(0).toUpperCase() + functionType.slice(1)}: ${isActive ? 'ON' : 'OFF'}`);
      }

      // Clear existing timeout for this function
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }

      // Set auto-off timer if function is activated
      if (isActive) {
        const duration = config.waterFunctionDuration;
        log(`${name} ${functionType}: Auto-off in ${duration} seconds`);
        
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          this.toiletState[stateKey] = false;
          
          // Send off command
          const offHexData = this.data[`${functionType}Off`];
          if (offHexData) {
            await this.performSend(offHexData);
          }
          
          // Update service characteristic
          const serviceManager = this.serviceManagers[functionType];
          if (serviceManager) {
            serviceManager.setCharacteristic(Characteristic.On, false);
          }
          
          delete this.waterFunctionTimeouts[functionType];
          log(`${name} ${functionType}: Auto-off executed`);
        }, duration * 1000);
      }
    });
  }

  // Dry function handler
  async setDryState(hexData, previousValue) {
    await catchDelayCancelError(async () => {
      const { config, log, name } = this;
      const isActive = !previousValue;
      
      this.toiletState.dryActive = isActive;
      
      if (hexData) {
        await this.performSend(hexData);
        log(`${name} Dry: ${isActive ? 'ON' : 'OFF'}`);
      }

      // Clear existing timeout
      if (this.waterFunctionTimeouts.dry) {
        clearTimeout(this.waterFunctionTimeouts.dry);
        delete this.waterFunctionTimeouts.dry;
      }

      // Set auto-off timer if activated
      if (isActive) {
        const duration = config.dryFunctionDuration;
        log(`${name} Dry: Auto-off in ${duration} seconds`);
        
        this.waterFunctionTimeouts.dry = setTimeout(async () => {
          this.toiletState.dryActive = false;
          
          // Send off command
          const offHexData = this.data.dryOff;
          if (offHexData) {
            await this.performSend(offHexData);
          }
          
          // Update service characteristic
          if (this.serviceManagers.dry) {
            this.serviceManagers.dry.setCharacteristic(Characteristic.On, false);
          }
          
          delete this.waterFunctionTimeouts.dry;
          log(`${name} Dry: Auto-off executed`);
        }, duration * 1000);
      }
    });
  }

  // Getter methods for characteristics
  getPowerSaveState(callback) {
    callback(null, this.toiletState.powerSaveState);
  }

  getShowerState(callback) {
    callback(null, this.toiletState.showerActive);
  }

  getBidetState(callback) {
    callback(null, this.toiletState.bidetActive);
  }

  getDryState(callback) {
    callback(null, this.toiletState.dryActive);
  }

  getServices() {
    const services = this.getInformationServices();
    
    // Add all service managers
    services.push(this.serviceManager.service);
    
    Object.values(this.serviceManagers || {}).forEach(serviceManager => {
      services.push(serviceManager.service);
    });
    
    return services;
  }

  setupServiceManager() {
    const { data, name, config, serviceManagerType } = this;
    const { 
      powerOn, powerOff, powerSaveOn, powerSaveOff, 
      showerOn, showerOff, bidetOn, bidetOff, 
      dryOn, dryOff 
    } = data || {};

    // Validate required hex codes
    const requiredCodes = [
      'powerOn', 'powerOff', 'powerSaveOn', 'powerSaveOff',
      'showerOn', 'showerOff', 'bidetOn', 'bidetOff',
      'dryOn', 'dryOff'
    ];
    
    const missingCodes = requiredCodes.filter(code => !data || !data[code]);
    if (missingCodes.length > 0) {
      this.log(`${name} Warning: Missing hex codes: ${missingCodes.join(', ')}`);
    }

    // Create service managers object to hold multiple services
    this.serviceManagers = {};

    // 1. Main Power Switch (Primary Service)
    this.serviceManager = new ServiceManagerTypes[serviceManagerType](name, Service.Switch, this.log);
    
    this.serviceManager.addToggleCharacteristic({
      name: 'switchState',
      type: Characteristic.On,
      getMethod: this.getCharacteristicValue,
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: powerOn,
        offData: powerOff,
        setValuePromise: this.setPowerState.bind(this)
      }
    });

    // 2. Power Save Switch
    const powerSaveName = config.powerSaveName || 'Power Save';
    this.serviceManagers.powerSave = new ServiceManagerTypes[serviceManagerType](
      powerSaveName, Service.Switch, this.log
    );
    
    this.serviceManagers.powerSave.addToggleCharacteristic({
      name: 'powerSaveState',
      type: Characteristic.On,
      getMethod: this.getPowerSaveState.bind(this),
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: powerSaveOn,
        offData: powerSaveOff,
        setValuePromise: this.setPowerSaveState.bind(this)
      }
    });

    // 3. Shower Switch
    const showerName = config.showerName || 'Shower';
    this.serviceManagers.shower = new ServiceManagerTypes[serviceManagerType](
      showerName, Service.Switch, this.log
    );
    
    this.serviceManagers.shower.addToggleCharacteristic({
      name: 'showerState',
      type: Characteristic.On,
      getMethod: this.getShowerState.bind(this),
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: showerOn,
        offData: showerOff,
        setValuePromise: (hexData, previousValue) => this.setWaterFunction('shower', hexData, previousValue)
      }
    });

    // 4. Bidet Switch
    const bidetName = config.bidetName || 'Bidet';
    this.serviceManagers.bidet = new ServiceManagerTypes[serviceManagerType](
      bidetName, Service.Switch, this.log
    );
    
    this.serviceManagers.bidet.addToggleCharacteristic({
      name: 'bidetState',
      type: Characteristic.On,
      getMethod: this.getBidetState.bind(this),
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: bidetOn,
        offData: bidetOff,
        setValuePromise: (hexData, previousValue) => this.setWaterFunction('bidet', hexData, previousValue)
      }
    });

    // 5. Dry Fan
    const dryName = config.dryName || 'Dry';
    this.serviceManagers.dry = new ServiceManagerTypes[serviceManagerType](
      dryName, Service.Fan, this.log
    );
    
    this.serviceManagers.dry.addToggleCharacteristic({
      name: 'dryState',
      type: Characteristic.On,
      getMethod: this.getDryState.bind(this),
      setMethod: this.setCharacteristicValue,
      bind: this,
      props: {
        onData: dryOn,
        offData: dryOff,
        setValuePromise: this.setDryState.bind(this)
      }
    });
  }
}

module.exports = SmartToiletSeatAccessory;