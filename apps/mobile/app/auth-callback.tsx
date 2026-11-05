import { Redirect } from 'expo-router';

// Retour de connexion Google / Facebook : la session est échangée par signInWithProvider.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
