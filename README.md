One of the more fun aspects of TypeScript is how its rich type system enables you to hoist business problems into the type system to leverage the language to eliminate potential sources of error. On a few recent projects with nontrivial authorization needs, we’ve been using some simple techniques to do this with permissions checking and enforcement.

The heart of the technique was [documented by Scott Wlaschin](https://fsharpforfunandprofit.com/posts/capability-based-security-3/) in his great blog, F# for Fun and Profit. Scott shows how you can create types that represent access tokens for particular permissions, and have the services that perform potentially unauthorized operations require a value of that type to perform the operation.

For example, let’s say our application has general system settings that only administrators are allowed to change. We might have a function in our service layer that looks something like this:

```ts
// Service layer / business logic layer
function updateSystemSettings(
  permission: PermissionToChangeSystemSettings,
  newSettings: SystemSettings
) {
  //....
}
```

By having a type represent permission to perform the operation and requiring a value of that type to perform the operation, we’ve got an API that’s impossible to accidentally call in a context where you haven’t proved you have that permission.

We’ve got a simple pattern and some lightweight support code for implementing this model in typescript - code and examples [on GitHub](https://github.com/atomicobject/typescript-permissions-demo). At a high level, we do the following:

1. Define specific permissions as types using the [Single-Valued Type](https://spin.atomicobject.com/2020/10/05/single-valued-type-pattern/?preview_id=161686&post_format=standard&_thumbnail_id=-1) pattern.
2. Have routines in our service layer take values of  the corresponding permission type as an argument.
3. Define an “authorizer” that provides permission-checker functions that attempt to produce a value of the requested permission type and fail if the request isn’t authorized.
4. API endpoints such as GraphQL resolvers or HTTP handlers request permissions from the authorizer and use them to invoke service layer business logic.

## 1. Define permissions
Defining a basic permission is straightforward:

```ts
export const PermissionToChangeSystemSettings = Permission.declare(
  "ChangeSystemSettings"
);
export type PermissionToChangeSystemSettings = PermissionInstanceType<
  typeof PermissionToChangeSystemSettings
>;
```

This does two things. First, it defines a simple permission to change system settings. In this example, the permission is all-or-nothing - you either have this permission or you do not. These simple or “unit” permissions just need a string identifier to capture which permission it is.

Two different things are created in this example - a constant and a type. The constant is a run-time representation of the general permission to change system settings in our [Single-Valued Type](https://spin.atomicobject.com/2020/10/05/single-valued-type-pattern/?preview_id=161686&post_format=standard&_thumbnail_id=-1) model - it’s used later when defining strategies for providing permissions. The type generated from it is the type of value you get when you actually use the permission.

### Complex Permissions

Simple permissions are one thing, but are often not granular enough. In real apps, you usually have permissions that vary more from user-to-user or entity-to-entity. For example, an app that allows users to create and view documents may want to ensure they can only be accessed by the owner.

So for more sophisticated cases, it’s useful to enable the permission to include runtime information indicating the precise scope of what’s been granted. For example, permission to “view a document” above, might be written as

```ts
/** Grants permission to view a specific document, captured by the document ID. */
export const PermissionToViewDocument = Permission.declare(
  "PermissionToViewDocument",
  Permission.ofType<{ documentId: DocumentId }>()
);
export type PermissionToViewDocument = PermissionInstanceType<
  typeof PermissionToViewDocument
>;
```

Declaration looks much the same as the `PermissionToChangeSystemSettings` above, but with the addition of `Permission.ofType` as a second argument to the declaration. This signature for `Permission.declare` allows you to specify an object payload type that can include any runtime data needed to understand the scope of the permission. That information will be present at runtime for any service layer method that’s consuming a permission.

## 2. Service Layer Routines Accept Permission Values
Once the types exist, code can start to be written that uses those permissions. As a general rule, any business logic that has authorization rules should take a reasonably-specific permission representing that permission:

```ts
function getDocumentContent(
  permission: PermissionToViewDocument
): Promise<string> {
  return loadDocumentContentFromDb(permission.documentId);
}
```

Since these functions take a permission value as an argument, and the only way to get a permission value is to prove you have that permission, it becomes statically impossible to forget to check permissions in well-typed code.

One important principle we use with these permission types is to make the runtime data “load-bearing” - the runtime data encoded in the permission is used as the source of truth for the relevant target entities etc. In practice, this usually means taking entities or entity IDs from the permission itself instead of having those be passed in as separate arguments. This reduces the chance of inadvertently granting access to a different entity or behavior than what was granted. Additional arguments to these functions are totally fine - just so long as they don’t relate to what thing has actually been authorized.

Need to unit test? You can use `Permission.unsafeGrant` to manufacture permissions for testing, or if you’re writing system code that by definition has access, e.g.

```ts
updateSystemSettings(Permission.unsafeGrant(PermissionToChangeSystemSettings), someNewValue);

const viewDocPerm = Permission.unsafeGrant(PermissionToViewDocument, { documentId: 32});
getDocumentContent(viewDocPerm)
```

## 3. Create a Permission Checker

In principle, permission checkers can just be functions that return `SomePermission | null`. If you are allowed to perform the operation, you get a value of that type. If not, you don’t. In practice, we find it helpful to generate slightly richer APIs for checking permissions.

First, we create an `Authorizer` class that is constructed with user session info for convenience:

```ts
class Authorizer {
  constructor(private _user: UserSession) {}
  // ...
}
```

An instance of this is reachable from our dependency injection context for easy use (passed into all our GraphQL resolvers and express handlers).

Within the authorizer, we have a family of “permission” checkers, which look like:

```ts
  canChangeSystemSettings = Permission.checker(
    PermissionToChangeSystemSettings,
    () => {
      return this._user.role === "admin";
    }
  );
```

These checkers tie a specific permission to the necessary logic to prove that permission is allowed. For simple permissions, we can provide a synchronous or asynchronous predicate function. `Permission.checker` returns an object with three methods:

```ts
  /** Perform a simple permission check, returning null if permission is denied. */
  test(...args: TArgs): TPerm | null;

  /** Check for permission and return any data related to why permission was denied. */
  check(...args: TArgs): TPerm | Denial;

  /** Check for permission and throw a PermissionError if permission was denied */
  enforce(...args: TArgs): TPerm;
```

These methods provide convenient ways to check depending on the use-case. For simple cases where you simply want to do a simple test for whether or not a request is authorized, you can use `test`. `test` returns the requested permission or `null`, and can be used to guide conditional logic.

For rest APIs and certain other use cases, it’s often nice to be able to fall back on a generic “access denied” fallback path. `enforce` is useful for this purpose - it returns the required permission if allowed, or throws a `PermissionError` if not. It’s then easy to test for thrown `PermissionError` in an express middleware or other generic context to fall back on one-size-fits-all logic for common cases. For example, our rest APIs just respond with a `403` when `PermissionError` is uncaught.

`check` is like test, but gives you access to the message summarizing why permission was denied. It’s not as convenient as null checking, so we don’t use it often unless we’re aiming to e.g. log info about why access was denied.

## Check for Permission Before Calling Service Layer
Finally, tie it all together by testing for permissions in your API endpoints, background jobs, etc. to verify permission before calling into your authorized service layer logic.

For HTTP endpoints, we’ll often use enforce for a convient check-and-call pattern, such as

```ts
app.post('/settings', wrapRequest(async (req,res) => {
	await updateSystemSettings(
    auth.canChangeSystemSettings.enforce(),
    req.body
  );
  res.json({ status: 'ok' })
}))
```

Where `wrapRequest` might catch `PermissionError` and respond with a `403` among other things.

And that’s about it!