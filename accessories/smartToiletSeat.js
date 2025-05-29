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
    super.setDefaults();
    const { config } = this;
    
    // Set default auto-off duration for water functions
    config.waterFunctionDuration = config.waterFunctionDuration || 60;
    config.dryFunctionDuration = config.dryDuration || 60;

    // Set default power state to ON when initialized
    if (this.state.switchState === undefined) {
      this.state.switchState = true;
    }
  }

  reset() {
    super.reset();

    // Clear all function timeouts
    Object.keys(this.waterFunctionTimeouts).forEach(key => {
      try {
        if (this.waterFunctionTimeouts[key]) {
          clearTimeout(this.waterFunctionTimeouts[key]);
          delete this.waterFunctionTimeouts[key];
        }
      } catch (error) {
        if (this.logLevel <= 4) {
          this.log(`Error clearing timeout for ${key}: ${error.message}`);
        }
      }
    });
  }

  // Main power handler
  async setPowerState(hexData, previousValue) {
    const { config, state, log, name, logLevel } = this;
    
    try {
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} Power: ${state.switchState ? 'ON' : 'OFF'}`);
        }
      }

      // If turning OFF main power, turn off all other functions
      if (!state.switchState) {
        if (logLevel <= 2) {
          log(`${name} Main power OFF - turning off all functions`);
        }
        
        // Turn off all toilet functions
        this.toiletState.powerSaveState = false;
        this.toiletState.showerActive = false;
        this.toiletState.bidetActive = false;
        this.toiletState.dryActive = false;

        // Clear all timeouts
        Object.keys(this.waterFunctionTimeouts).forEach(key => {
          if (this.waterFunctionTimeouts[key]) {
            clearTimeout(this.waterFunctionTimeouts[key]);
            delete this.waterFunctionTimeouts[key];
          }
        });

        // Update all service characteristics
        this.serviceManagers.forEach(service => {
          if (service.subtype === 'powersave') {
            service.updateCharacteristic(Characteristic.On, false);
          } else if (service.subtype === 'shower' || service.subtype === 'bidet') {
            service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
            service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
          } else if (service.subtype === 'dry') {
            service.updateCharacteristic(Characteristic.On, false);
          }
        });

        // Send off commands for all functions
        const { data } = this;
        if (data.powerSaveOff) await this.performSend(data.powerSaveOff);
        if (data.showerOff) await this.performSend(data.showerOff);
        if (data.bidetOff) await this.performSend(data.bidetOff);
        if (data.dryOff) await this.performSend(data.dryOff);
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Power control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Getter methods for characteristics
  getOutletInUse(callback) {
    // OutletInUse should return true when the outlet is in use (powered on)
    callback(null, this.state.switchState || false);
  }

  async setWaterFunction(functionType, active) {
    const { config, log, name, logLevel, data } = this;
    const stateKey = `${functionType}Active`;
    
    try {
      this.toiletState[stateKey] = active;
      const hexData = active ? data[`${functionType}On`] : data[`${functionType}Off`];
      
      if (hexData) {
        await this.performSend(hexData);
        if (logLevel <= 2) {
          log(`${name} ${functionType}: ${active ? 'ON' : 'OFF'}`);
        }
      }

      // If turning ON this function, turn OFF the other water/dry functions (mutual exclusion)
      if (active) {
        const otherFunctions = ['shower', 'bidet', 'dry'].filter(f => f !== functionType);
        
        for (const otherFunction of otherFunctions) {
          if (this.toiletState[`${otherFunction}Active`]) {
            if (logLevel <= 2) {
              log(`${name} ${functionType} ON - turning off ${otherFunction} (UI only, no IR command)`);
            }
            
            // Update internal state
            this.toiletState[`${otherFunction}Active`] = false;
            
            // DON'T send off command - let the function stop naturally
            // const offHexData = data[`${otherFunction}Off`];
            // if (offHexData) {
            //   await this.performSend(offHexData);
            // }
            
            // Clear timeout for other function
            if (this.waterFunctionTimeouts[otherFunction]) {
              clearTimeout(this.waterFunctionTimeouts[otherFunction]);
              delete this.waterFunctionTimeouts[otherFunction];
            }
            
            // Update other service UI
            const otherService = this.serviceManagers.find(s => s.subtype === otherFunction);
            if (otherService) {
              if (otherFunction === 'dry') {
                otherService.updateCharacteristic(Characteristic.On, false);
              } else {
                otherService.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
                otherService.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
              }
            }
          }
        }
      }

      // Clear existing timeout for this function
      if (this.waterFunctionTimeouts[functionType]) {
        clearTimeout(this.waterFunctionTimeouts[functionType]);
        delete this.waterFunctionTimeouts[functionType];
      }

      // Set auto-off timer if activated
      if (active) {
        const duration = functionType === 'dry' ? config.dryFunctionDuration : config.waterFunctionDuration;
        if (logLevel <= 2) {
          log(`${name} ${functionType}: Auto-off in ${duration} seconds`);
        }
        
        this.waterFunctionTimeouts[functionType] = setTimeout(async () => {
          try {
            this.toiletState[stateKey] = false;
            
            // Send off command for auto-off (this is different from manual switching)
            const offHexData = data[`${functionType}Off`];
            if (offHexData) {
              await this.performSend(offHexData);
            }
            
            // Find and update the service
            const service = this.serviceManagers.find(s => s.subtype === functionType);
            if (service) {
              if (functionType === 'dry') {
                service.updateCharacteristic(Characteristic.On, false);
              } else {
                service.updateCharacteristic(Characteristic.Active, Characteristic.Active.INACTIVE);
                service.updateCharacteristic(Characteristic.InUse, Characteristic.InUse.NOT_IN_USE);
              }
            }
            
            delete this.waterFunctionTimeouts[functionType];
            
            if (logLevel <= 2) {
              log(`${name} ${functionType}: Auto-off executed`);
            }
          } catch (timeoutError) {
            if (logLevel <= 4) {
              log(`${name} ${functionType} auto-off error: ${timeoutError.message}`);
            }
            delete this.waterFunctionTimeouts[functionType];
          }
        }, duration * 1000);
      }
    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} ${functionType} control error: ${error.message}`);
      }
      throw error;
    }
  }

  // Follow TV accessory pattern for multiple services
  getServices() {
    const services = this.getInformationServices();
    
    // Add primary service (via ServiceManager)
    services.push(this.serviceManager.service);
    
    // Add additional services (manual services)
    services.push(...this.serviceManagers);
    
    return services;
  }

  // Primary service via ServiceManager + additional services manually (like TV accessory)
  setupServiceManager() {
    const { data, name, config, serviceManagerType, log, logLevel } = this;
    
    // Validate data exists
    if (!data) {
      const message = `${name}: No data configuration provided`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    const { 
      powerOn, powerOff, powerSaveOn, powerSaveOff, 
      showerOn, showerOff, bidetOn, bidetOff, 
      dryOn, dryOff 
    } = data;

    // Validate required hex codes
    const requiredCodes = {
      powerOn: 'Main power on',
      powerOff: 'Main power off', 
      powerSaveOn: 'Power save on',
      powerSaveOff: 'Power save off',
      showerOn: 'Shower on',
      showerOff: 'Shower off',
      bidetOn: 'Bidet on', 
      bidetOff: 'Bidet off',
      dryOn: 'Dry on',
      dryOff: 'Dry off'
    };
    
    const missingCodes = Object.keys(requiredCodes).filter(code => !data[code]);
    if (missingCodes.length > 0) {
      const missing = missingCodes.map(code => requiredCodes[code]).join(', ');
      const message = `${name}: Missing required hex codes: ${missing}`;
      if (logLevel <= 4) {
        log(message);
      }
      throw new Error(message);
    }

    try {
      // 1. PRIMARY SERVICE via ServiceManager (like TV accessory does)
      this.serviceManager = new ServiceManagerTypes[serviceManagerType](name, Service.Outlet, this.log);
      
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

      // Add OutletInUse characteristic for Outlet service
      this.serviceManager.addGetCharacteristic({
        name: 'outletInUse',
        type: Characteristic.OutletInUse,
        method: this.getOutletInUse,
        bind: this
      });

      // 2. ADDITIONAL SERVICES manually (like TV accessory does)
      this.serviceManagers = [];

      // Get service names from config
      const serviceNames = {
        powerSave: config.powerSaveName || 'Power Save',
        shower: config.showerName || 'Shower',
        bidet: config.bidetName || 'Bidet',
        dry: config.dryName || 'Dry'
      };

      // Power Save Switch
      const powerSaveService = new Service.Switch(serviceNames.powerSave, 'powersave');
      powerSaveService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      powerSaveService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.powerSave);
      powerSaveService.getCharacteristic(Characteristic.On)
        .onGet(() => this.toiletState.powerSaveState)
        .onSet(async (value) => {
          try {
            this.toiletState.powerSaveState = value;
            const hexData = value ? data.powerSaveOn : data.powerSaveOff;
            if (hexData) {
              await this.performSend(hexData);
            }
            if (logLevel <= 2) {
              log(`${name} Power Save: ${value ? 'ON' : 'OFF'}`);
            }
          } catch (error) {
            log(`${name} Power Save error: ${error.message}`);
          }
        });
      this.serviceManagers.push(powerSaveService);

      // Shower Valve
      const showerService = new Service.Valve(serviceNames.shower, 'shower');
      showerService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      showerService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.shower);
      showerService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
      showerService.getCharacteristic(Characteristic.Active)
        .onGet(() => this.toiletState.showerActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
        .onSet(async (value) => {
          const isActive = value === Characteristic.Active.ACTIVE;
          await this.setWaterFunction('shower', isActive);
        });
      showerService.getCharacteristic(Characteristic.InUse)
        .onGet(() => this.toiletState.showerActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
      this.serviceManagers.push(showerService);

      // Bidet Valve
      const bidetService = new Service.Valve(serviceNames.bidet, 'bidet');
      bidetService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      bidetService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.bidet);
      bidetService.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);
      bidetService.getCharacteristic(Characteristic.Active)
        .onGet(() => this.toiletState.bidetActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
        .onSet(async (value) => {
          const isActive = value === Characteristic.Active.ACTIVE;
          await this.setWaterFunction('bidet', isActive);
        });
      bidetService.getCharacteristic(Characteristic.InUse)
        .onGet(() => this.toiletState.bidetActive ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
      this.serviceManagers.push(bidetService);

      // Dry Fan
      const dryService = new Service.Fan(serviceNames.dry, 'dry');
      dryService.addOptionalCharacteristic(Characteristic.ConfiguredName);
      dryService.setCharacteristic(Characteristic.ConfiguredName, serviceNames.dry);
      dryService.getCharacteristic(Characteristic.On)
        .onGet(() => this.toiletState.dryActive)
        .onSet(async (value) => {
          // Use the same logic as water functions for mutual exclusion
          await this.setWaterFunction('dry', value);
        });
      this.serviceManagers.push(dryService);

      if (logLevel <= 2) {
        log(`${name}: Successfully configured with ${this.serviceManagers.length + 1} services`);
        log(`${name}: Primary: ${name} (Outlet), Additional: ${Object.values(serviceNames).join(', ')}`);
      }

    } catch (error) {
      if (logLevel <= 4) {
        log(`${name} Error setting up service managers: ${error.message}`);
      }
      throw error;
    }
  }
}

module.exports = SmartToiletSeatAccessory;