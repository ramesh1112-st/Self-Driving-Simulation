import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

model = genai.GenerativeModel("gemini-1.5-flash-latest")

def explain_decision(data):
    prompt = f"""
    Explain this self-driving action:

    Object: {data['object']}
    Distance: {data['distance']}
    Action: {data['action']}
    """

    response = model.generate_content(prompt)

    return response.text