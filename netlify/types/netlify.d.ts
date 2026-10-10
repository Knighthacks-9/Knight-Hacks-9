// The global Netlify Functions 2.0 provides at runtime (declared here so the
// functions type-check without adding @netlify/functions as a dependency).
declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};
