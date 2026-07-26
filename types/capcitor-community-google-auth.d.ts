declare module "@capacitor-community/google-auth" {
  export const GoogleAuth: {
    initialize(options?: { clientId?: string; scopes?: string[]; [key: string]: unknown }): Promise<void>;
    signIn(): Promise<{ accessToken?: string; idToken?: string; [key: string]: unknown }>;
    signOut(): Promise<void>;
    getCurrentUser?(): Promise<unknown>;
  };

  export default GoogleAuth;
}
