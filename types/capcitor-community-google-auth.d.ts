declare module "@capacitor-community/google-auth" {
  export const GoogleAuth: {
    initialize(options?: { clientId?: string; scopes?: string[]; [key: string]: any }): Promise<void>;
    signIn(): Promise<{ accessToken?: string; idToken?: string; [key: string]: any }>;
    signOut(): Promise<void>;
    getCurrentUser?(): Promise<any>;
  };

  export default GoogleAuth;
}
