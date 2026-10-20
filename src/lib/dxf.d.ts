declare module "dxf" {
  export const config: { verbose: boolean };
  export class Helper {
    constructor(contents: string);
    readonly parsed: {
      entities: { type: string }[];
      header?: Record<string, unknown>;
    };
    toSVG(): string;
  }
}
