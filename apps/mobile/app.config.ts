import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';

// Configuration dynamique : les clés propres à l'appareil Android (Google Maps, Firebase)
// sont injectées au moment du build (secrets GitHub), jamais écrites dans le dépôt.
const base = {
  "name": "Kin Marché en ligne",
  "slug": "kin-marche-en-ligne",
  "scheme": "kinmarche",
  "version": "0.1.0",
  "orientation": "portrait",
  "icon": "./assets/images/icon.png",
  "userInterfaceStyle": "automatic",
  "description": "Supermarché en ligne en RDC — Au prix du Grand Marché",
  "splash": {
    "image": "./assets/images/logo-wide.png",
    "resizeMode": "contain",
    "backgroundColor": "#FFFFFF"
  },
  "ios": {
    "supportsTablet": true,
    "bundleIdentifier": "cd.kinmarche.enligne",
    "infoPlist": {
      "NSCameraUsageDescription": "La caméra sert à scanner le code-barres d'un produit.",
      "NSLocationWhenInUseUsageDescription": "Votre position sert à trouver le supermarché Kin Marché qui peut vous livrer.",
      "NSMicrophoneUsageDescription": "Le micro sert à rechercher un produit à la voix.",
      "NSPhotoLibraryUsageDescription": "Vos photos servent à rechercher un produit ou à joindre un document."
    }
  },
  "android": {
    "package": "cd.kinmarche.enligne",
    "adaptiveIcon": {
      "foregroundImage": "./assets/images/adaptive-icon.png",
      "backgroundColor": "#FFFFFF"
    },
    "permissions": [
      "CAMERA",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "RECORD_AUDIO"
    ]
  },
  "web": {
    "bundler": "metro",
    "output": "single",
    "favicon": "./assets/images/favicon.png"
  },
  "plugins": [
    "expo-router",
    [
      "expo-camera",
      {
        "cameraPermission": "La caméra sert à scanner le code-barres d'un produit."
      }
    ],
    [
      "expo-location",
      {
        "locationWhenInUsePermission": "Votre position sert à trouver le supermarché Kin Marché qui peut vous livrer."
      }
    ],
    "expo-notifications",
    "expo-localization",
    [
      "expo-speech-recognition",
      {
        "microphonePermission": "Le micro sert à rechercher un produit à la voix.",
        "speechRecognitionPermission": "La reconnaissance vocale sert à rechercher un produit à la voix.",
        "androidSpeechServicePackages": [
          "com.google.android.googlequicksearchbox"
        ]
      }
    ]
  ],
  "experiments": {
    "typedRoutes": false
  },
  "extra": {
    "developer": "MATULA DESIGN"
  }
} as ExpoConfig;

const mapsKey = process.env.GOOGLE_MAPS_ANDROID_KEY;
const googleServices = process.env.GOOGLE_SERVICES_JSON_PATH;
const easProjectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  ...base,
  android: {
    ...base.android,
    ...(googleServices && fs.existsSync(googleServices) ? { googleServicesFile: googleServices } : {}),
    config: { ...(base.android?.config ?? {}), ...(mapsKey ? { googleMaps: { apiKey: mapsKey } } : {}) },
  },
  extra: {
    ...base.extra,
    // Sur Android, la carte n'est affichée que si la clé Google Maps a été fournie au build.
    mapsEnabled: { android: !!mapsKey, ios: true, web: false },
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
