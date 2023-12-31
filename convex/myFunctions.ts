import { customCtx, customQuery } from "convex-helpers/server/customFunctions";
import {
  DocumentByName,
  FieldTypeFromFieldPath,
  GenericDataModel,
  GenericDatabaseReader,
  GenericQueryCtx,
  NamedTableInfo,
  Query,
  TableNamesInDataModel,
} from "convex/server";
import { GenericId } from "convex/values";
import { query as baseQuery, mutation } from "./_generated/server";
import { EdgeConfig, Expand, GenericEntsDataModel } from "./ents/schema";
import { entDefinitions } from "./schema";

type FieldTypes<
  DataModel extends GenericDataModel,
  Table extends TableNamesInDataModel<DataModel>,
  T extends string[]
> = {
  [K in keyof T]: FieldTypeFromFieldPath<
    DocumentByName<DataModel, Table>,
    T[K]
  >;
};

class QueryQueryOrNullPromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends Promise<EntByName<DataModel, EntsDataModel, Table>[] | null> {
  constructor(
    protected ctx: GenericQueryCtx<DataModel>,
    protected entDefinitions: EntsDataModel,
    protected table: Table,
    protected retrieve: (
      db: GenericDatabaseReader<DataModel>
    ) => Promise<Query<NamedTableInfo<DataModel, Table>> | null>
  ) {
    super(() => {});
  }

  take(n: number): QueryMultipleOrNullPromise<DataModel, EntsDataModel, Table> {
    return new QueryMultipleOrNullPromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const query = await this.retrieve(db);
        if (query === null) {
          return null;
        }
        return query.take(n);
      }
    );
  }

  first(): QueryOnePromise<DataModel, EntsDataModel, Table> {
    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const query = await this.retrieve(db);
        if (query === null) {
          return null;
        }
        return query.first();
      }
    );
  }

  then<
    TResult1 = EntByName<DataModel, EntsDataModel, Table>[] | null,
    TResult2 = never
  >(
    onfulfilled?:
      | ((
          value: EntByName<DataModel, EntsDataModel, Table>[] | null
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return this.retrieve(this.ctx.db)
      .then((query) => (query === null ? null : query.collect()))
      .then((documents) =>
        documents === null
          ? null
          : documents.map((doc) =>
              entWrapper(doc, this.ctx, this.entDefinitions, this.table)
            )
      )
      .then(onfulfilled, onrejected);
  }
}

class QueryQueryPromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends Promise<EntByName<DataModel, EntsDataModel, Table>[]> {
  constructor(
    protected ctx: GenericQueryCtx<DataModel>,
    protected entDefinitions: EntsDataModel,
    protected table: Table,
    protected retrieve: (
      db: GenericDatabaseReader<DataModel>
    ) => Promise<Query<NamedTableInfo<DataModel, Table>>>
  ) {
    super(() => {});
  }

  take(n: number): QueryMultiplePromise<DataModel, EntsDataModel, Table> {
    return new QueryMultiplePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const query = await this.retrieve(db);
        return query.take(n);
      }
    );
  }

  first(): QueryOnePromise<DataModel, EntsDataModel, Table> {
    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const query = await this.retrieve(db);
        if (query === null) {
          return null;
        }
        return query.first();
      }
    );
  }

  then<
    TResult1 = EntByName<DataModel, EntsDataModel, Table>[],
    TResult2 = never
  >(
    onfulfilled?:
      | ((
          value: EntByName<DataModel, EntsDataModel, Table>[]
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return this.retrieve(this.ctx.db)
      .then((query) => query.collect())
      .then((documents) =>
        documents.map((doc) =>
          entWrapper(doc, this.ctx, this.entDefinitions, this.table)
        )
      )
      .then(onfulfilled, onrejected);
  }
}

class QueryPromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends QueryQueryPromise<DataModel, EntsDataModel, Table> {
  constructor(
    ctx: GenericQueryCtx<DataModel>,
    entDefinitions: EntsDataModel,
    table: Table
  ) {
    super(ctx, entDefinitions, table, async (db) => db.query(table));
  }

  get<
    Indexes extends DataModel[Table]["indexes"],
    Index extends keyof Indexes,
    IndexTypes extends string[] = Indexes[Index]
  >(
    indexName: Index,
    ...values: FieldTypes<DataModel, Table, IndexTypes>
  ): QueryOnePromise<DataModel, EntsDataModel, Table>;
  get(id: GenericId<Table>): QueryOnePromise<DataModel, EntsDataModel, Table>;
  get(...args: any[]) {
    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      args.length === 1
        ? (db) => {
            const id = args[0] as GenericId<Table>;
            if (this.ctx.db.normalizeId(this.table, id) === null) {
              return Promise.reject(
                new Error(`Invalid id \`${id}\` for table "${this.table}"`)
              );
            }
            return db.get(id);
          }
        : (db) => {
            const [indexName, value] = args;
            return db
              .query(this.table)
              .withIndex(indexName, (q) => q.eq(indexName, value))
              .unique();
          }
    );
  }
}

// This query materializes objects, so chaining to this type of query performs one operation for each
// retrieved document in JavaScript, basically as if using
// `Promise.all()`.
class QueryMultipleOrNullPromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends Promise<EntByName<DataModel, EntsDataModel, Table>[] | null> {
  constructor(
    private ctx: GenericQueryCtx<DataModel>,
    private entDefinitions: EntsDataModel,
    private table: Table,
    private retrieve: (
      db: GenericDatabaseReader<DataModel>
    ) => Promise<DocumentByName<DataModel, Table>[] | null>
  ) {
    super(() => {});
  }

  // This just returns the first retrieved document, it does not optimize
  // the previous steps in the query.
  first(): QueryOnePromise<DataModel, EntsDataModel, Table> {
    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const docs = await this.retrieve(db);
        if (docs === null) {
          return null;
        }
        return docs[0] ?? null;
      }
    );
  }

  then<
    TResult1 = EntByName<DataModel, EntsDataModel, Table>[] | null,
    TResult2 = never
  >(
    onfulfilled?:
      | ((
          value: EntByName<DataModel, EntsDataModel, Table>[] | null
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return this.retrieve(this.ctx.db)
      .then((docs) =>
        docs === null
          ? null
          : docs.map((doc) =>
              entWrapper(doc, this.ctx, this.entDefinitions, this.table)
            )
      )
      .then(onfulfilled, onrejected);
  }
}

// This query materializes objects, so chaining to this type of query performs one operation for each
// retrieved document in JavaScript, basically as if using
// `Promise.all()`.
class QueryMultiplePromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends Promise<EntByName<DataModel, EntsDataModel, Table>[]> {
  constructor(
    private ctx: GenericQueryCtx<DataModel>,
    private entDefinitions: EntsDataModel,
    private table: Table,
    private retrieve: (
      db: GenericDatabaseReader<DataModel>
    ) => Promise<DocumentByName<DataModel, Table>[]>
  ) {
    super(() => {});
  }

  // This just returns the first retrieved document, it does not optimize
  // the previous steps in the query.
  first(): QueryOnePromise<DataModel, EntsDataModel, Table> {
    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      this.table,
      async (db) => {
        const docs = await this.retrieve(db);
        if (docs === null) {
          return null;
        }
        return docs[0] ?? null;
      }
    );
  }

  then<
    TResult1 = EntByName<DataModel, EntsDataModel, Table>[],
    TResult2 = never
  >(
    onfulfilled?:
      | ((
          value: EntByName<DataModel, EntsDataModel, Table>[]
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return this.retrieve(this.ctx.db)
      .then((docs) =>
        docs.map((doc) =>
          entWrapper(doc, this.ctx, this.entDefinitions, this.table)
        )
      )
      .then(onfulfilled, onrejected);
  }
}

class QueryOnePromise<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> extends Promise<EntByName<DataModel, EntsDataModel, Table> | null> {
  constructor(
    private ctx: GenericQueryCtx<DataModel>,
    private entDefinitions: EntsDataModel,
    private table: Table,
    private retrieve: (
      db: GenericDatabaseReader<DataModel>
    ) => Promise<DocumentByName<DataModel, Table> | null>
  ) {
    super(() => {});
  }

  then<
    TResult1 = EntByName<DataModel, EntsDataModel, Table> | null,
    TResult2 = never
  >(
    onfulfilled?:
      | ((
          value: EntByName<DataModel, EntsDataModel, Table> | null
        ) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null
  ): Promise<TResult1 | TResult2> {
    return this.retrieve(this.ctx.db)
      .then((doc) =>
        doc === null
          ? null
          : entWrapper(doc, this.ctx, this.entDefinitions, this.table)
      )
      .then(onfulfilled, onrejected);
  }

  edge<Edge extends keyof EntsDataModel[Table]["edges"]>(
    edge: Edge
  ): EntsDataModel[Table]["edges"][Edge]["cardinality"] extends "multiple"
    ? QueryMultipleOrNullPromise<
        DataModel,
        EntsDataModel,
        EntsDataModel[Table]["edges"][Edge]["to"]
      >
    : QueryOnePromise<
        DataModel,
        EntsDataModel,
        EntsDataModel[Table]["edges"][Edge]["to"]
      > {
    const edgeDefinition: EdgeConfig = (
      this.entDefinitions[this.table].edges as any
    ).filter(({ name }: EdgeConfig) => name === edge)[0];

    if (edgeDefinition.cardinality === "multiple") {
      if (edgeDefinition.type === "ref") {
        return new QueryMultipleOrNullPromise(
          this.ctx,
          this.entDefinitions,
          edgeDefinition.to,
          async (db) => {
            const doc = await this.retrieve(db);
            if (doc === null) {
              return null;
            }
            const edgeDocs = await db
              .query(edgeDefinition.table)
              .withIndex(edgeDefinition.field, (q) =>
                q.eq(edgeDefinition.field, doc._id as any)
              )
              .collect();
            return (
              await Promise.all(
                edgeDocs.map((edgeDoc) =>
                  db.get(edgeDoc[edgeDefinition.ref] as any)
                )
              )
            ).filter(<TValue>(doc: TValue | null, i: number): doc is TValue => {
              if (doc === null) {
                throw new Error(
                  `Dangling reference "${
                    edgeDocs[i][edgeDefinition.field] as string
                  }" found in document with _id "${
                    edgeDocs[i]._id as string
                  }", expected to find a document with the first ID.`
                );
              }
              return true;
            });
          }
        ) as any;
      }
      return new QueryQueryOrNullPromise(
        this.ctx,
        this.entDefinitions,
        edgeDefinition.to,
        async (db) => {
          const doc = await this.retrieve(db);
          if (doc === null) {
            return null;
          }
          return db
            .query(edgeDefinition.to)
            .withIndex(edgeDefinition.ref, (q) =>
              q.eq(edgeDefinition.ref, doc._id as any)
            );
        }
      ) as any;
    }

    return new QueryOnePromise(
      this.ctx,
      this.entDefinitions,
      edgeDefinition.to,
      async (db) => {
        const doc = await this.retrieve(db);
        if (doc === null) {
          return null;
        }

        if (edgeDefinition.type === "ref") {
          const inverseEdgeDefinition: EdgeConfig = (
            this.entDefinitions[edgeDefinition.to].edges as any
          ).filter(({ to }: EdgeConfig) => to === this.table)[0];
          if (inverseEdgeDefinition.type !== "field") {
            throw new Error(
              `Unexpected inverse edge type for edge: ${edgeDefinition.name}, ` +
                `expected field, got ${inverseEdgeDefinition.type} ` +
                `named ${inverseEdgeDefinition.name}`
            );
          }

          return await this.ctx.db
            .query(edgeDefinition.to)
            .withIndex(edgeDefinition.ref, (q) =>
              q.eq(edgeDefinition.ref, doc._id as any)
            )
            .unique();
        }

        return await this.ctx.db.get(doc[edgeDefinition.field] as any);
      }
    ) as any;
  }
}

function entWrapper<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
>(
  doc: DocumentByName<DataModel, Table>,
  ctx: GenericQueryCtx<DataModel>,
  entDefinitions: EntsDataModel,
  table: Table
): EntByName<DataModel, EntsDataModel, Table> {
  const queryInterface = new QueryOnePromise(
    ctx,
    entDefinitions,
    table,
    async () => doc
  );
  Object.defineProperty(doc, "edge", {
    value: (edge: any) => {
      return queryInterface.edge(edge);
    },
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return doc as any;
}

function tableFactory<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>
>(ctx: GenericQueryCtx<DataModel>, entDefinitions: EntsDataModel) {
  return <Table extends TableNamesInDataModel<DataModel>>(table: Table) => {
    return new QueryPromise(ctx, entDefinitions, table);
  };
}

const query = customQuery(
  baseQuery,
  customCtx(async (ctx) => {
    return {
      table: tableFactory(ctx, entDefinitions),
      db: undefined,
    };
  })
);

type EntByName<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>
> = Expand<
  DocumentByName<DataModel, Table> & {
    edge<Edge extends keyof EntsDataModel[Table]["edges"]>(
      edge: Edge
    ): EdgeQuery<DataModel, EntsDataModel, Table, Edge>;
  }
>;

type EdgeQuery<
  DataModel extends GenericDataModel,
  EntsDataModel extends GenericEntsDataModel<DataModel>,
  Table extends TableNamesInDataModel<DataModel>,
  Edge extends keyof EntsDataModel[Table]["edges"]
> = EntsDataModel[Table]["edges"][Edge]["cardinality"] extends "multiple"
  ? QueryMultipleOrNullPromise<
      DataModel,
      EntsDataModel,
      EntsDataModel[Table]["edges"][Edge]["to"]
    >
  : QueryOnePromise<
      DataModel,
      EntsDataModel,
      EntsDataModel[Table]["edges"][Edge]["to"]
    >;

export const test = query({
  args: {},

  handler: async (ctx) => {
    {
      const [first, second] = await ctx.table("users").take(2);
      const user = Math.random() > 0.5 ? first : second;
      const foo = await user.edge("followees").first();
      return foo;
    }
    {
      const firstsFollowees = await ctx
        .table("users")
        .first()
        .edge("followees")
        .first();
      return firstsFollowees;
    }
    {
      const firstMessageTags = await ctx.table("messages").first().edge("tags");
      return firstMessageTags;
    }
    {
      const firstUserProfile = await ctx.table("users").first().edge("profile");
      return firstUserProfile;
    }
    {
      const lastMessageAuthorsMessages = await ctx
        .table("messages")
        .first()
        .edge("user")
        .edge("messages");
      return lastMessageAuthorsMessages;
    }
    {
      const lastMessageAuthor = await ctx
        .table("messages")
        .first()
        .edge("user");
      return lastMessageAuthor;
    }
    {
      // const postsByUser = await ctx
      // .table("users")
      // .get("email", "srb@convex.dev")
      // // .edge("posts")
      // .map(async (user) => (
      //   ctx.table("posts")
      //     .withIndex("authorId", (q) => q.eq("authorId", user._id))
      // ));
    }
    {
      // const message = await ctx
      //   .table("messages")
      //   .get("authorId", "jh76hs45yga4pgptp21nxhfdx96gf8xr" as any);
      // return message;
    }

    {
      const messages = await ctx.table("messages");
      return messages;
    }
    {
      const message = await ctx.table("messages").get("123123213" as any);
      return message;
    }
    {
      const messages = await ctx.table("messages").first();
      return messages;
    }

    // // For single field indexes, we should be able to eq or lt gt directly - but that doesn't
    // // work as you might have multiple indexes with the same first field - you have to
    // // choose the index in convex model, but as Ian suggested if you choose a single field index
    // // you can inline the eq condition, so
    // await ctx.table("messages").get("author", foo._id); // note not authorId even though that's the underlying index
    // // Retrieve the posts of a user
    // // const postsByUser: Post[] = await prisma.user
    // //   .findUnique({ where: { email: "ada@prisma.io" } })
    // //   .posts();
    // const postsByUser = await ctx
    //   .table("users")
    //   .get("email", "srb@convex.dev")
    //   .edge("posts");
    // // Retrieve the profile of a user via a specific post
    // // const authorProfile: Profile | null = await prisma.post
    // // .findUnique({ where: { id: 1 } })
    // // .author()
    // // .profile();
    // const authorProfile = await ctx
    //   .table("posts")
    //   .get(1)
    //   .edge("author")
    //   .edge("profile");
    // // Return all users and include their posts and profile
    // // const users: User[] = await prisma.user.findMany({
    // //   include: {
    // //     posts: true,
    // //     profile: true,
    // //   },
    // // });
    // const users = await ctx.table("users").map(async (user) => ({
    //   ...user,
    //   posts: await user.edge("posts"),
    //   profile: await user.edge("profile"),
    // }));
    // // Select all users and all their post titles
    // // const userPosts = await prisma.user.findMany({
    // //   select: {
    // //     name: true,
    // //     posts: {
    // //       select: {
    // //         title: true,
    // //       },
    // //     },
    // //   },
    // // });
    // const userPosts = await ctx.table("users").map(async (user) => ({
    //   name: user.name,
    //   posts: await user.edge("posts"),
    // }));

    // But if I already have a user, how do I get the posts from them?
    // const user = await ctx.table("users").get("email", "srb@...");
    // const posts = await user.edge("posts");

    // // List all messages
    // // const allPosts = ctx.db.query("posts").collect();
    // const allPosts = await ctx.table("posts");
    // // const userById = ctx.db.get(id);
    // const userById = await ctx.table("posts");
    //// Read the database as many times as you need here.
    //// See https://docs.convex.dev/database/reading-data.
    // const numbers = await ctx.db
    //   .query("numbers")
    //   // Ordered by _creationTime, return most recent
    //   .order("desc")
    //   .take(args.count);
    // return numbers.toReversed().map((number) => number.value);
  },
});

export const seed = mutation(async (ctx) => {
  for (const table of [
    "users",
    "messages",
    "profiles",
    "tags",
    "documents",
    "messages_to_tags",
  ]) {
    for (const { _id } of await ctx.db.query(table as any).collect()) {
      await ctx.db.delete(_id);
    }
  }

  const userId = await ctx.db.insert("users", { name: "Stark" });
  const userId2 = await ctx.db.insert("users", { name: "Musk" });
  const messageId = await ctx.db.insert("messages", {
    text: "Hello world",
    userId,
  });
  await ctx.db.insert("profiles", {
    bio: "Hello world",
    userId,
  });
  const tagsId = await ctx.db.insert("tags", {
    name: "Orange",
  });
  await ctx.db.insert("messages_to_tags" as any, {
    messagesId: messageId,
    tagsId: tagsId,
  });
  await ctx.db.insert("users_followees_to_followers" as any, {
    followeesId: userId2,
    followersId: userId,
  });
});

export const list = query(async (ctx, args) => {
  return await ctx.table(args.table as any);
});
