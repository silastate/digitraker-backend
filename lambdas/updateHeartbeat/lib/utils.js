"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFloatFromInt = exports.HexToASCII = exports.HexToFloat32 = exports.convertToCelsius = exports.roundDecimalDigits = exports.formatHexId = exports.hexToBytes = void 0;
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
const missingProbe = '7F800000';
const infinity = 'FF800000';
// Convert a hex string to a byte array
const hexToBytes = (hex) => {
    hex = hex.split(' ').join('');
    const NumberChars = hex.length;
    const bytes = new Uint8Array(NumberChars / 2);
    for (let c = 0; c < NumberChars; c += 2) {
        bytes[c / 2] = parseInt(hex.substr(c, 2), 16);
    }
    return bytes;
};
exports.hexToBytes = hexToBytes;
const formatHexId = (id) => {
    if (id.length === 1) {
        id = '00' + id;
    }
    if (id.length === 2) {
        id = '0' + id;
    }
    return id;
};
exports.formatHexId = formatHexId;
const roundDecimalDigits = (value, places = 2) => {
    return +value.toFixed(places);
};
exports.roundDecimalDigits = roundDecimalDigits;
const convertToCelsius = (value) => {
    let temp = value;
    temp = ((value - 32) * 5 / 9);
    temp = (0, exports.roundDecimalDigits)(temp);
    return temp;
};
exports.convertToCelsius = convertToCelsius;
const HexToFloat32 = (str) => {
    if (str === missingProbe || str === infinity) {
        return undefined;
    }
    else {
        const int = parseInt(str, 16);
        if (int > 0 || int < 0) {
            const sign = int >>> 31 ? -1 : 1;
            let exp = (int >>> 23 & 0xff) - 127;
            const mantissa = ((int & 0x7fffff) + 0x800000).toString(2);
            let float32 = 0;
            for (let i = 0; i < mantissa.length; i += 1) {
                float32 += parseInt(mantissa[i]) ? Math.pow(2, exp) : 0;
                exp--;
            }
            return float32 * sign;
        }
        else
            return 0;
    }
};
exports.HexToFloat32 = HexToFloat32;
const HexToASCII = (str1) => {
    const hex = str1.toString();
    let str = '';
    for (let n = 0; n < hex.length; n += 2) {
        str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
    }
    return str;
};
exports.HexToASCII = HexToASCII;
const getFloatFromInt = (fbInt) => {
    const array = getInt32Bytes(fbInt);
    const data = new Uint8Array(4);
    data[0] = array[0];
    data[1] = array[1];
    data[2] = array[2];
    data[3] = array[3];
    const f32 = new Float32Array(data.buffer);
    return f32[0];
};
exports.getFloatFromInt = getFloatFromInt;
function getInt32Bytes(x) {
    const bytes = [];
    let i = 0;
    do {
        bytes[i++] = x & (255);
        x = x >> 8;
    } while (i < 4);
    return bytes;
}
