import os
from dotenv import load_dotenv
from groq import Groq

# Load environment variables
load_dotenv()

# Initialize Groq client
client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

def explain_decision(data):
    try:
        prompt = f"""
        Explain this self-driving car decision in simple and short words:

        Object detected: {data['object']}
        Distance: {data['distance']}
        Action taken: {data['action']}

        Why did the car take this action?
        """

        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )

        explanation = response.choices[0].message.content
        return explanation

    except Exception as e:
        return f"Error in explanation: {str(e)}"