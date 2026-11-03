#!/bin/bash

echo "Starting Arsa Sales CRM (SaaS)..."

# Trap CTRL+C to kill all background processes
trap "echo 'Shutting down both frontend and backend...'; kill 0; exit" SIGINT

# --- BACKEND ---
echo "Setting up backend..."
cd backend

# Create venv if not exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate

# Install requirements if requirements.txt exists (creating one just in case)
echo "django" > requirements.txt
echo "djangorestframework" >> requirements.txt
echo "django-cors-headers" >> requirements.txt
pip install -r requirements.txt

# Run migrations
echo "Running database migrations..."
python manage.py makemigrations lands
python manage.py migrate

# Start backend server in the background
echo "Starting Django backend server..."
python manage.py runserver 8000 &
BACKEND_PID=$!
cd ..

# --- FRONTEND ---
echo "Setting up frontend..."
cd frontend

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

# Start frontend development server
echo "Starting React development server..."
npm run dev &
FRONTEND_PID=$!

echo "Both servers are running!"
echo "Backend is at http://localhost:8000"
echo "Frontend is at http://localhost:5173"
echo "Press CTRL+C to stop both servers."

# Wait for background processes to keep script running
wait
