import type { ExpoConfig } from 'expo/config';
import fs from 'node:fs';

// Configuration dynamique : les clés propres à l'appareil Android (Google Maps, Firebase)
// sont injectées au moment du build (secrets GitHub), jamais écrites dans le dépôt.
const base = {
  "name": "Kin Marché en ligne",
  "slug": "kin-marche-en-ligne",
  "scheme": "kinmarche",
  "version": "2.0.0",
  "orientation": "portrait",
  "icon": "./assets/images/icon.png",
  "userInterfaceStyle": "automatic",
  "description": "Supermarché en ligne en RDC — Au prix du Grand Marché",
  "splash": {
    "image": "./assets/images/splash-logo.png",
    "resizeMode": "contain",
    "backgroundColor": "#CE0000"
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
      "backgroundImage": "./assets/images/adaptive-icon-background.png",
      "monochromeImage": "./assets/images/adaptive-icon-monochrome.png",
      "backgroundColor": "#CE0000"
    },
    "permissions": [
      "CAMERA",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "RECORD_AUDIO",
      "REQUEST_INSTALL_PACKAGES"
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
    [
      "expo-notifications",
      {
        "icon": "./assets/images/notification-icon.png",
        "color": "#CE0000"
      }
    ],
    "expo-localization",
    [
      "expo-splash-screen",
      {
        "image": "./assets/images/splash-logo.png",
        "imageWidth": 220,
        "resizeMode": "contain",
        "backgroundColor": "#CE0000"
      }
    ],
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

// Numéro de build : celui du workflow GitHub (APK n°…), toujours croissant → mise à jour par-dessus l'ancienne version.
const buildNumber = Number(process.env.GITHUB_RUN_NUMBER ?? process.env.BUILD_NUMBER ?? '') || undefined;
const mapsKey = process.env.GOOGLE_MAPS_ANDROID_KEY;
const googleServices = process.env.GOOGLE_SERVICES_JSON_PATH;
const easProjectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  ...base,
  android: {
    ...base.android,
    ...(buildNumber ? { versionCode: buildNumber } : {}),
    ...(googleServices && fs.existsSync(googleServices) ? { googleServicesFile: googleServices } : {}),
    config: { ...(base.android?.config ?? {}), ...(mapsKey ? { googleMaps: { apiKey: mapsKey } } : {}) },
  },
  extra: {
    ...base.extra,
    buildNumber: buildNumber ?? null,
    // Sur Android, la carte n'est affichée que si la clé Google Maps a été fournie au build.
    mapsEnabled: { android: !!mapsKey, ios: true, web: false },
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
