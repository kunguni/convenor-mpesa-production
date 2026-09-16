require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY
);

async function test() {
    try {
        const { data, error } = await supabase
            .from("payments")
            .select("*")
            .limit(1);

        if (error) {
            console.error("❌ SUPABASE API ERROR:");
            console.error(error.message);
            return;
        }

        console.log("=================================");
        console.log("🎉 SUPABASE API CONNECTION SUCCESS!");
        console.log("=================================");
        console.log("Data:", data);

    } catch (error) {
        console.error("❌ CONNECTION FAILED:");
        console.error(error.message);
    }
}

test();