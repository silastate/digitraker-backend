"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseData = void 0;
// #region imports
const utils_1 = require("./utils");
const parsedPacket_1 = require("./parsedPacket");
// #endregion
function parseData(dataPacket) {
    const parsedPacket = new parsedPacket_1.ParsedPacket();
    try {
        if (dataPacket !== undefined) {
            dataPacket = dataPacket.trim();
            if (dataPacket.length === 28 || dataPacket.length === 30) {
                parsedPacket.isParsed = true;
                const hexChars = dataPacket.split('');
                const productIdentifier = hexChars[0] + hexChars[1];
                if (productIdentifier === '20') { // fx300 sensor type
                    parsedPacket.deviceType = 'FX300';
                    const stat0 = (parseInt((hexChars[28] + hexChars[29]), 16).toString(2)).padStart(8, '0');
                    parsedPacket.isResetPressed = stat0.charAt(4) === '1';
                    parsedPacket.isBatteryAlert = stat0.charAt(1) === '1';
                    const subType = hexChars[2] + hexChars[3];
                    if (subType === '00') {
                        parsedPacket.sensorType = 'both channel mA';
                    }
                    else if (subType === '11') {
                        parsedPacket.sensorType = 'both channel V';
                    }
                    else if (subType === '22') {
                        parsedPacket.sensorType = 'both channel Positive Pressure';
                    }
                    else if (subType === '33') {
                        parsedPacket.sensorType = 'both channel Negative Pressure';
                    }
                    else {
                        parsedPacket.sensorType = '';
                        switch (hexChars[2]) {
                            case '0':
                                parsedPacket.sensorType += 'channel1 mA;';
                                break;
                            case '1':
                                parsedPacket.sensorType += 'channel1 V;';
                                break;
                            case '2':
                                parsedPacket.sensorType += 'channel1 Positive Pressure;';
                                break;
                            case '3':
                                parsedPacket.sensorType += 'channel1 Negative Pressure;';
                                break;
                            default:
                                parsedPacket.sensorType += 'channel1 No Probe;';
                                break;
                        }
                        switch (hexChars[3]) {
                            case '0':
                                parsedPacket.sensorType += ' channel2 mA';
                                break;
                            case '1':
                                parsedPacket.sensorType += ' channel2 V ';
                                break;
                            case '2':
                                parsedPacket.sensorType += ' channel2 Positive Pressure ';
                                break;
                            case '3':
                                parsedPacket.sensorType += ' channel2 Negative Pressure ';
                                break;
                            default:
                                parsedPacket.sensorType += ' channel2 No Probe';
                                break;
                        }
                    }
                    // channel 1
                    const hexChannel1 = hexChars[6] + hexChars[7] + hexChars[8] + hexChars[9] + hexChars[10] + hexChars[11] + hexChars[12] + hexChars[13];
                    const floatChannel1 = (0, utils_1.HexToFloat32)(hexChannel1);
                    if (floatChannel1 !== undefined) {
                        parsedPacket.channel1 = floatChannel1;
                    }
                    else {
                        parsedPacket.channel1 = 'Missing Probe';
                    }
                    // channel 2
                    const hexChannel2 = hexChars[14] + hexChars[15] + hexChars[16] + hexChars[17] + hexChars[18] + hexChars[19] + hexChars[20] + hexChars[21];
                    const floatChannel2 = (0, utils_1.HexToFloat32)(hexChannel2);
                    if (floatChannel2 !== undefined) {
                        parsedPacket.channel2 = floatChannel2;
                    }
                    else {
                        parsedPacket.channel2 = 'Missing Probe';
                    }
                }
                else if ('17,37'.includes(productIdentifier)) { // fx100 sensor type
                    parsedPacket.deviceType = 'FX100';
                    const stat0 = (parseInt((hexChars[26] + hexChars[27]), 16).toString(2)).padStart(8, '0');
                    parsedPacket.isResetPressed = stat0.charAt(4) === '1';
                    parsedPacket.isBatteryAlert = stat0.charAt(1) === '1';
                    // channel 1
                    const hexChannel1 = hexChars[4] + hexChars[5] + hexChars[6] + hexChars[7] + hexChars[8] + hexChars[9] + hexChars[10] + hexChars[11];
                    const floatChannel1 = (0, utils_1.HexToFloat32)(hexChannel1);
                    if (floatChannel1 !== undefined) {
                        parsedPacket.channel1 = floatChannel1;
                    }
                    else {
                        parsedPacket.channel1 = 'Missing Probe';
                    }
                    // channel 2
                    const hexChannel2 = hexChars[12] + hexChars[13] + hexChars[14] + hexChars[15] + hexChars[16] + hexChars[17] + hexChars[18] + hexChars[19];
                    const floatChannel2 = (0, utils_1.HexToFloat32)(hexChannel2);
                    if (floatChannel2 !== undefined) {
                        parsedPacket.channel2 = floatChannel2;
                    }
                    else {
                        parsedPacket.channel2 = 'Missing Probe';
                    }
                }
                else if ('15,16,35,36'.includes(productIdentifier)) { // fx200 sensor type
                    parsedPacket.deviceType = 'FX200';
                    const stat0 = (parseInt((hexChars[26] + hexChars[27]), 16).toString(2)).padStart(8, '0');
                    parsedPacket.isResetPressed = stat0.charAt(4) === '1';
                    parsedPacket.isBatteryAlert = stat0.charAt(1) === '1';
                    // channel 1
                    const hexChannel1 = hexChars[4] + hexChars[5] + hexChars[6] + hexChars[7] + hexChars[8] + hexChars[9] + hexChars[10] + hexChars[11];
                    const floatChannel1 = (0, utils_1.HexToFloat32)(hexChannel1);
                    if (floatChannel1 !== undefined) {
                        parsedPacket.channel1 = floatChannel1;
                    }
                    else {
                        parsedPacket.channel1 = 'Missing Probe';
                    }
                    // channel 2
                    const hexChannel2 = hexChars[12] + hexChars[13] + hexChars[14] + hexChars[15] + hexChars[16] + hexChars[17] + hexChars[18] + hexChars[19];
                    const floatChannel2 = (0, utils_1.HexToFloat32)(hexChannel2);
                    if (floatChannel2 !== undefined) {
                        parsedPacket.channel2 = floatChannel2;
                    }
                    else {
                        parsedPacket.channel2 = 'Missing Probe';
                    }
                }
                else {
                    throw (new Error('Invalid product identifier'));
                }
            }
            else {
                throw (new Error('Invalid data packet size'));
            }
        }
        else {
            throw (new Error('Invalid data packet'));
        }
    }
    catch (error) {
        parsedPacket.isParsed = false;
        parsedPacket.errorMsg = String(error);
    }
    return parsedPacket;
}
exports.parseData = parseData;
exports.default = { parseData };
