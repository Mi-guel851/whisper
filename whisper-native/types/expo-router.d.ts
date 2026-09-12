/**
 * The typed entry point.
 *
 * `expo-router/entry` ships only a `.js` file, so TypeScript reads it as `any`
 * and a strict build fails on the import. This declaration pins it to the same
 * default-export shape the module actually has (a registered root component),
 * which is all the type system needs to know about it.
 */
declare module "expo-router/entry" {
  import type { ComponentType } from "react";

  const Entry: ComponentType;
  export default Entry;
}
