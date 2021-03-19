import { Permission, PermissionInstanceType } from "./permissions";

// Example app permissions.

/** Grants permission to "change system settings". This is all-or-nothing access, with no further granularity. A 'unit' permission */
export const PermissionToChangeSystemSettings = Permission.declare( "ChangeSystemSettings");
export type PermissionToChangeSystemSettings = PermissionInstanceType<
  typeof PermissionToChangeSystemSettings
>;

/** Grants permission to view a specific document, captured by the document ID. */
export const PermissionToViewDocument = Permission.declare(
  "PermissionToViewDocument",
  Permission.ofType<{ documentId: DocumentId }>()
);
export type PermissionToViewDocument = PermissionInstanceType<
  typeof PermissionToViewDocument
>;

/** This can be whatever basic info about your user you have on hand during requests  */
type DocumentId = number;
type UserId = number;
interface UserSession {
  id: UserId;
  role: "admin" | "user";
}

interface DocumentMetadata {
  id: DocumentId;
  authorId: UserId;
}

class Authorizer {
  constructor(private _user: UserSession) {}

  canChangeSystemSettings = Permission.checker(
    PermissionToChangeSystemSettings,
    () => {
      return this._user.role === "admin";
    }
  );

  canViewDocument = Permission.asyncChecker(
    PermissionToViewDocument,
    async (documentId: DocumentId) => {
      const document = await loadDocumentMetadata(documentId)
      if (document.authorId == this._user.id) {
        return { documentId: document.id };
      } else {
        return Permission.deny();
      }
    }
  );
}

// Service layer / business logic layer
function updateSystemSettings(
  permission: PermissionToChangeSystemSettings,
  newSettings: SystemSettings
) {
  //....
}

function getDocumentContent(permission: PermissionToViewDocument): Promise<string> {
  return loadDocumentContentFromDb(permission.documentId);
}

// Data access functions
declare function loadDocumentMetadata(docId: DocumentId): Promise<DocumentMetadata>;
declare function loadDocumentContentFromDb(docId: DocumentId): Promise<string>;


async function documentContentResolver(_: any, args: {documentId: DocumentId}, ctx: {auth: Authorizer}) {
  const hasPermission = await ctx.auth.canViewDocument.enforce(args.documentId)
  return getDocumentContent(hasPermission)
}