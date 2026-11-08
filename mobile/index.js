/**
 * @format
 */

import 'react-native-get-random-values';
import { Buffer } from '@craftzdog/react-native-buffer';

global.Buffer = global.Buffer || Buffer;

if (typeof global.structuredClone !== 'function') {
  global.structuredClone = function structuredClone(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }
    if (obj instanceof RegExp) {
      return new RegExp(obj.source, obj.flags);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => structuredClone(item));
    }
    if (obj instanceof Uint8Array) {
      return new Uint8Array(obj);
    }
    if (obj instanceof ArrayBuffer) {
      return obj.slice(0);
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj)) {
      return Buffer.from(obj);
    }
    const clonedObj = Object.create(Object.getPrototypeOf(obj));
    for (const key of Object.keys(obj)) {
      clonedObj[key] = structuredClone(obj[key]);
    }
    return clonedObj;
  };
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
