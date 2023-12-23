import { redirect } from "next/navigation";
import sdk, { Query } from "node-appwrite";

import { client, clientAdmin } from "@/config/appwrite-server";

export async function POST(request) {
  const data = await request.json();
  console.info(`Rating ${data.rating} for ${data.url} recieved`);

  const sessionId = request.headers.get("sessionId");
  const jwt = request.headers.get("Authorization");
  const appwriteClient = client().setJWT(jwt);
  const account = new sdk.Account(appwriteClient);
  const session = await account.getSession(sessionId);

  // find user on github
  let rating = parseInt(data.rating);
  let username = "";
  try {
    const gitHubUserRes = await fetch("https://api.github.com/user", {
      headers: {
        "Content-Type": "application/vnd.github+json",
        Authorization: "Bearer " + session.providerAccessToken,
      },
    });
    const gitHubUserData = await gitHubUserRes.json();
    username = gitHubUserData.login;
  } catch (e) {
    return redirect("/auth/login");
  }
  console.info(`User ${username} submitted rating for ${data.url}`);

  // 0. get repo from github api
  const repoPath = data.url.split("github.com/");
  if (repoPath.length !== 2) {
    return Response.json({ success: false, error: "Invalid URL" });
  }
  const path =
    repoPath[1].slice(-1) === "/" ? repoPath[1].slice(0, -1) : repoPath[1];
  const repoRes = await fetch(`https://api.github.com/repos/${path}`, {
    headers: {
      Authorization: "Bearer " + session.providerAccessToken,
    },
  });
  const repoData = await repoRes.json();
  const githubRepo = {
    name: repoData.name,
    owner: repoData.owner.login,
    description: repoData.description,
    logo: repoData.owner.avatar_url,
  };
  console.info(`Repo ${githubRepo.name} found on GitHub`);

  // 1. check if user already rated this repo
  const userRepoRating = await new sdk.Databases(clientAdmin()).listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_COLLECTION_RATINGS_ID,
    [Query.equal("url", [data.url]), Query.equal("username", [username])]
  );

  // 2a. update in ratings collection
  if (userRepoRating.total === 1) {
    console.info(`User ${username} already rated ${data.url} updating rating`);
    await new sdk.Databases(clientAdmin()).updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_RATINGS_ID,
      userRepoRating.documents[0].$id,
      {
        username: username,
        url: data.url,
        rating: rating,
      }
    );
  } else {
    // 2b. create in ratings collection
    console.info(`User ${username} rating ${data.url} for the first time`);
    await new sdk.Databases(clientAdmin()).createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_RATINGS_ID,
      sdk.ID.unique(),
      {
        username: username,
        url: data.url,
        rating: rating,
      }
    );
  }

  // 3. check if repo exists
  console.info(`Checking if repo ${data.url} exists in database`);
  const repos = await new sdk.Databases(clientAdmin()).listDocuments(
    process.env.APPWRITE_DATABASE_ID,
    process.env.APPWRITE_COLLECTION_REPOS_ID,
    [Query.equal("url", [data.url])]
  );

  // 4a. update in repos collection + calculate new rating
  if (repos.total === 1) {
    console.info(`Repo ${data.url} found in database update rating`);
    // get all ratings for this repo
    const ratings = await new sdk.Databases(clientAdmin()).listDocuments(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_RATINGS_ID,
      [Query.equal("url", [data.url])]
    );

    // save new repo rating
    const averageRating =
      ratings.documents.reduce((acc, cur) => acc + cur.rating, 0) /
      ratings.total;
    const repo = await new sdk.Databases(clientAdmin()).updateDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_REPOS_ID,
      repos.documents[0].$id,
      {
        ...githubRepo,
        rating: averageRating,
        votes: ratings.total,
      }
    );
  } else {
    // 4a. create in repos collection
    console.info(
      `Repo ${data.url} not found in database create repo and ratings`
    );
    const repo = await new sdk.Databases(clientAdmin()).createDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_COLLECTION_REPOS_ID,
      sdk.ID.unique(),
      {
        ...githubRepo,
        url: data.url,
        rating: rating,
        votes: 1,
      }
    );
  }

  return Response.json({ success: true, data: githubRepo });
}
