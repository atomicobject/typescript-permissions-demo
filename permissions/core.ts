enum PermissionCategory {
  /** A permission that doesn't carry runtime data */
  Unit,
  /** A permission with an associated payload */
  Complex,
}

/** Type info that statically distinguishes permission by their label, even if data payload is the same type */
export type PermissionBrand<TBrand extends string> = { _permission: TBrand };

/** Data that should be present at runtime */
type PermissionTypeRuntime<TBrand extends string> = {
  _brand: TBrand;
  _category: PermissionCategory;
};

/** The type of a kind of permission. Not the type of an instance. See PermissionInstanceType for that */
export type PermissionType<
  TBrand extends string = string,
  TData = any
> = PermissionTypeRuntime<TBrand> &
  PermissionBrand<TBrand> & {
    _data: TData;
  };
export type UnitPermissionType<TBrand extends string = string> = PermissionType<
  TBrand,
  true
>;

/** The type of an instance for a kind of permission */
export type PermissionInstanceType<
  TPermType extends PermissionType = PermissionType,
  TValue extends PermissionTypeData<TPermType> = PermissionTypeData<TPermType>
> = TValue &
  PermissionBrand<PermissionBrandOf<TPermType>> & {
    _permissionType: TPermType;
  };

type PermissionValueType<T> = T;
/** Use this and pass the result as a second argument to `declare` to provide a payload type for complex permissions */
export function ofType<T>(): PermissionValueType<T> {
  return {} as any;
}

/** Defines a permission type. One argument for a simple/unit permission, pass a second argument from ofType to associate runtime data*/
export function declare<TBrand extends string>(
  brand: TBrand
): PermissionType<TBrand, true>;
/** Defines a permission type. Use ofType to provide a second argument to specify runtime data, such as identifiers of entities that the permission is granted for */
export function declare<TBrand extends string, TData>(
  brand: TBrand,
  type: PermissionValueType<TData>
): PermissionType<TBrand, TData>;
export function declare<TBrand extends string, TData>(
  brand: TBrand,
  type?: PermissionValueType<TData>
): PermissionType<TBrand, TData> {
  if (type) {
    const data: PermissionTypeRuntime<TBrand> = {
      _brand: brand,
      _category: PermissionCategory.Complex,
    };
    return data as any;
  } else {
    const data: PermissionTypeRuntime<TBrand> = {
      _brand: brand,
      _category: PermissionCategory.Unit,
    };
    return data as any;
  }
}

export type PermissionTypeData<TPermT extends PermissionType> = TPermT["_data"];
export type PermissionBrandOf<
  TPermT extends PermissionBrand<any>
> = TPermT["_permission"];
export type PermissionTypeGrant<
  TPermT extends PermissionType
> = PermissionInstanceType<TPermT>;

/** Returns a value proving the user has permission. Don't call this unless you're sure the user should have this permission or you're in a testing environment! */
export function unsafeGrant<TPerm extends UnitPermissionType>(
  perm: TPerm
): PermissionInstanceType<TPerm>;
export function unsafeGrant<TPerm extends PermissionType>(
  perm: TPerm,
  data: PermissionTypeData<TPerm>
): PermissionInstanceType<TPerm>;
export function unsafeGrant<TPerm extends PermissionType>(
  perm: TPerm,
  data?: PermissionTypeData<TPerm>
): PermissionInstanceType<TPerm> {
  return perm._category === PermissionCategory.Unit ? true : (data as any);
}

/** Thrown when permission is denied */
export class PermissionError extends Error {}

export type PermissionChecker<
  TArgs extends any[],
  TPerm extends PermissionInstanceType
> = {
  /** Perform a simple permission check, returning null if permission is denied. */
  test(...args: TArgs): TPerm | null;
  /** Check for permission and return any data related to why permission was denied. */
  check(...args: TArgs): TPerm | Denial;
  /** Check for permission and throw a PermissionError if permission was denied */
  enforce(...args: TArgs): TPerm;
};

export type Denial = { denial: string };

/** Deny access via a standard string description */
export function deny(denial?: string): Denial {
  return { denial: denial ?? ("Permission denied" as any) };
}

/** Bless a function as a valid checker for a particular permission */
export function checker<TPermT extends UnitPermissionType, TArgs extends any[]>(
  perm: TPermT,
  func: (...args: TArgs) => boolean | Denial
): PermissionChecker<TArgs, PermissionInstanceType<TPermT>>; // failure type not necessary?

export function checker<
  TPermT extends PermissionType,
  TArgs extends any[],
  TResult extends PermissionTypeData<TPermT>,
  T
>(
  perm: TPermT,
  func: (...args: TArgs) => TResult | Denial
): PermissionChecker<TArgs, PermissionInstanceType<TPermT, TResult>>;

export function checker(
  perm: PermissionType,
  func: any
): PermissionChecker<any[], any> {
  const result: PermissionChecker<any[], any> = {
    test: (...args: any[]) => {
      const result = func(...args);
      return !result || isDenied(result) ? null : result;
    },
    check: (...args: any[]) => {
      const result = func(...args);
      return result || deny();
    },
    enforce: (...args: any) => {
      const result = func(...args);
      if (isDenied(result) || !result) {
        throw new PermissionError(`Didn't have permission "${perm._brand}"`);
      }
      return result;
    },
  };

  return result;
}

export function isDenied<T>(perm: unknown): perm is Denial {
  return (typeof perm === "object" && perm && "denial" in perm) || false;
}

export type AsyncPermissionChecker<
  TArgs extends any[],
  TPerm extends PermissionInstanceType
> = {
  test(...args: TArgs): Promise<TPerm | null>;
  check(...args: TArgs): Promise<TPerm | Denial>;
  enforce(...args: TArgs): Promise<TPerm>;
};
/** Bless an async function as a valid checker for a particular permission */
export function asyncChecker<
  TPermT extends UnitPermissionType,
  TArgs extends any[]
>(
  perm: TPermT,
  func: (...args: TArgs) => boolean | Promise<boolean>
): AsyncPermissionChecker<TArgs, PermissionInstanceType<TPermT, true>>;

export function asyncChecker<
  TPermT extends PermissionType,
  TArgs extends any[],
  TResult extends PermissionTypeData<TPermT>,
  T
>(
  perm: TPermT,
  func: (...args: TArgs) => Promise<TResult | Denial>
): AsyncPermissionChecker<TArgs, PermissionInstanceType<TPermT, TResult>>;

export function asyncChecker(perm: any, func: any) {
  const result: AsyncPermissionChecker<any, any> = {
    test: async (...args: any[]) => {
      const result = await func(...args); // await handles promises and non-promises
      return isDenied(result) || !result ? null : result;
    },

    check: async (...args: any[]) => {
      const result = await func(...args); // await handles promises and non-promises
      return result || deny();
    },

    enforce: async (...args: any) => {
      const result = await func(...args);
      if (isDenied(result) || !result) {
        throw new PermissionError(`Didn't have permission "${perm._brand}"`);
      }
      return result;
    },
  };
  return result;
}
