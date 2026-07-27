type GoogleAuthValue = string | number | boolean | null | undefined | string[];

declare module "@capacitor-community/google-auth" {
  export const GoogleAuth: {
    initialize(options?: { clientId?: string; scopes?: string[]; [key: string]: GoogleAuthValue }): Promise<void>;
    signIn(): Promise<{ accessToken?: string; idToken?: string; [key: string]: GoogleAuthValue }>;
    signOut(): Promise<void>;
    getCurrentUser?(): Promise<Record<string, GoogleAuthValue>>;
  };

  export default GoogleAuth;
}
