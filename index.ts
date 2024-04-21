import { Hono } from "hono";
import sharp from "sharp";
import fs from "fs";
import { supabase } from "./utils/supabase-service-client";

const app = new Hono();

app.post("/watermark", async (req, res) => {
  const body = await req.req.json();

  // console.log where request is coming from
  console.log(req.req.header());

  const predictionId = body.id;
  const status = body.status;

  if (body.status === "failed") {
    await supabase
      .from("images")
      .update({
        status: "error",
      })
      .eq("prediction_id", predictionId);

    return;
  }

  const { data: imageWithProfile } = await supabase
    .from("images")
    .select("*, profiles(*)")
    .eq("prediction_id", predictionId)
    .single();

  if (!imageWithProfile) {
    return new Response(null, {
      status: 404,
    });
  }

  const profile = imageWithProfile.profiles;

  const isPaidUser = profile?.is_paid_user;

  if (!profile) {
    return new Response(null, {
      status: 404,
    });
  }

  console.log("isPaidUser", isPaidUser);
  console.log("status", status);
  console.log(profile);

  if (isPaidUser) {
    const { data } = await supabase.storage
      .from("images-processed")
      .upload(`${profile.id}/${body.id}`, body.output[0]);

    const {
      data: { publicUrl },
    } = supabase.storage
      .from("images-processed")
      .getPublicUrl(data?.path || "");

    await supabase
      .from("images")
      .update({
        status: "completed",
        processed_url: publicUrl,
        with_watermark: false,
      })
      .eq("prediction_id", predictionId);

    return new Response(null, {
      status: 200,
    });
  }

  await supabase
    .from("images")
    .update({
      status: "adding_watermark",
      with_watermark: true,
    })
    .eq("prediction_id", predictionId)
    .throwOnError();

  console.log("adding watermark");

  const composite = fs.readFileSync("./RetroPhotoco.png");

  const replicateImageResult = body.output[0];

  const response = await fetch(replicateImageResult);
  const buffer = await response.arrayBuffer();
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const mainImageHeight = metadata.height || 0;

  // calculate watermark size
  const watermarkHeight = Math.floor(mainImageHeight / 20);

  const watermark = await sharp(composite)
    .resize({
      height: watermarkHeight,
    })
    .toBuffer();

  const output = await sharp(buffer)
    .composite([
      {
        input: watermark,
        top: 50,
        left: 50,
      },
    ])
    .png()
    .toBuffer();

  const { data } = await supabase.storage
    .from("images-processed")
    .upload(`${profile.id}/${body.id}`, output);

  if (!data?.path) {
    return new Response(null, {
      status: 500,
    });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("images-processed").getPublicUrl(data.path);

  await supabase
    .from("images")
    .update({
      status: "completed",
      processed_url: publicUrl,
    })
    .eq("prediction_id", body.id);

  return new Response("success");
});

Bun.serve({
  fetch: app.fetch,
  port: 4000,
});
