package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"golang.org/x/crypto/bcrypt"
)

type User struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name      string             `bson:"name" json:"name"`
	Email     string             `bson:"email" json:"email"`
	Password  string             `bson:"password" json:"-"`
	CreatedAt time.Time          `bson:"createdAt" json:"createdAt"`
}

type Option struct {
	ID    string `bson:"id" json:"id"`
	Text  string `bson:"text" json:"text"`
	Votes int    `bson:"votes" json:"votes"`
}

type Poll struct {
	ID              primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Question        string             `bson:"question" json:"question"`
	Options         []Option           `bson:"options" json:"options"`
	CreatorID       primitive.ObjectID `bson:"creatorId" json:"creatorId"`
	CreatorName     string             `bson:"creatorName" json:"creatorName"`
	ExpiresAt       *time.Time         `bson:"expiresAt,omitempty" json:"expiresAt,omitempty"`
	CreatedAt       time.Time          `bson:"createdAt" json:"createdAt"`
	TotalVotes      int                `bson:"totalVotes" json:"totalVotes"`
	Quiz            bool               `bson:"quiz,omitempty" json:"quiz,omitempty"`
	CorrectOptionID string             `bson:"correctOptionId,omitempty" json:"-"`
}

type Vote struct {
	ID        primitive.ObjectID `bson:"_id,omitempty"`
	PollID    primitive.ObjectID `bson:"pollId"`
	UserID    primitive.ObjectID `bson:"userId"`
	OptionID  string             `bson:"optionId"`
	CreatedAt time.Time          `bson:"createdAt"`
}

type Claims struct {
	UserID string `json:"uid"`
	Name   string `json:"name"`
	jwt.RegisteredClaims
}

var ctx = context.Background()

var users *mongo.Collection
var polls *mongo.Collection
var votes *mongo.Collection
var rdb *redis.Client
var jwtSecret []byte

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		allowed := env("FRONTEND_ORIGIN", "http://localhost:5173")
		return origin == "" || origin == allowed
	},
}

func main() {
	_ = godotenv.Load()

	jwtSecret = []byte(env("JWT_SECRET", "dev-only-change-me"))

	client, err := mongo.Connect(
		ctx,
		options.Client().ApplyURI(
			env("MONGO_URI", "mongodb://localhost:27017"),
		),
	)
	if err != nil {
		log.Fatal(err)
	}

	db := client.Database(env("MONGO_DB", "pulsevote"))

	users = db.Collection("users")
	polls = db.Collection("polls")
	votes = db.Collection("votes")

	_, err = votes.Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{
			{Key: "pollId", Value: 1},
			{Key: "userId", Value: 1},
		},
		Options: options.Index().SetUnique(true),
	})
	if err != nil {
		log.Fatal(err)
	}

	rdb = redis.NewClient(&redis.Options{
		Addr: env("REDIS_ADDR", "localhost:6379"),
	})

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatal("Redis connection: ", err)
	}

	g := gin.Default()
	g.Use(cors())

	api := g.Group("/api")
	api.POST("/auth/signup", signup)
	api.POST("/auth/login", login)
	api.GET("/polls", listPolls)
	api.GET("/polls/:id", getPoll)
	api.POST("/polls", auth(), createPoll)
	api.POST("/polls/:id/vote", auth(), castVote)
	api.GET("/polls/:id/analytics", pollAnalytics)
	api.DELETE("/polls/:id", auth(), deletePoll)
	api.PUT("/polls/:id", auth(), updatePoll)
	api.GET("/polls/:id/quiz-result", auth(), quizResult)

	g.GET("/ws/polls/:id", pollSocket)

	port := env("PORT", "8080")
	log.Println("PulseVote API listening on :" + port)
	log.Fatal(g.Run(":" + port))
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header(
			"Access-Control-Allow-Origin",
			env("FRONTEND_ORIGIN", "http://localhost:5173"),
		)
		c.Header(
			"Access-Control-Allow-Headers",
			"Authorization, Content-Type",
		)
		c.Header(
			"Access-Control-Allow-Methods",
			"GET, POST, PUT, DELETE, OPTIONS",
		)
		c.Header("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := strings.TrimPrefix(
			c.GetHeader("Authorization"),
			"Bearer ",
		)

		token, err := jwt.ParseWithClaims(
			header,
			&Claims{},
			func(t *jwt.Token) (interface{}, error) {
				return jwtSecret, nil
			},
		)

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(
				401,
				gin.H{"error": "Authentication required"},
			)
			return
		}

		claims, ok := token.Claims.(*Claims)
		if !ok {
			c.AbortWithStatus(401)
			return
		}

		id, err := primitive.ObjectIDFromHex(claims.UserID)
		if err != nil {
			c.AbortWithStatus(401)
			return
		}

		c.Set("userID", id)
		c.Set("userName", claims.Name)
		c.Next()
	}
}

func getUserID(c *gin.Context) (primitive.ObjectID, bool) {
	value, exists := c.Get("userID")
	if !exists {
		return primitive.NilObjectID, false
	}

	id, ok := value.(primitive.ObjectID)
	if !ok {
		return primitive.NilObjectID, false
	}

	return id, true
}
func issueToken(u User) string {
	token := jwt.NewWithClaims(
		jwt.SigningMethodHS256,
		Claims{
			UserID: u.ID.Hex(),
			Name:   u.Name,
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(
					time.Now().Add(7 * 24 * time.Hour),
				),
			},
		},
	)

	signed, err := token.SignedString(jwtSecret)
	if err != nil {
		log.Println("JWT signing error:", err)
		return ""
	}

	return signed
}

func signup(c *gin.Context) {
	var in struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if c.ShouldBindJSON(&in) != nil ||
		len(strings.TrimSpace(in.Name)) < 2 ||
		!strings.Contains(in.Email, "@") ||
		len(in.Password) < 8 {

		c.JSON(400, gin.H{
			"error": "Enter a name, valid email, and password of at least 8 characters",
		})
		return
	}

	in.Email = strings.ToLower(strings.TrimSpace(in.Email))

	count, err := users.CountDocuments(
		ctx,
		bson.M{"email": in.Email},
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "Database error"})
		return
	}

	if count > 0 {
		c.JSON(409, gin.H{"error": "Email already registered"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword(
		[]byte(in.Password),
		bcrypt.DefaultCost,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "Could not create account"})
		return
	}

	u := User{
		ID:        primitive.NewObjectID(),
		Name:      strings.TrimSpace(in.Name),
		Email:     in.Email,
		Password:  string(hash),
		CreatedAt: time.Now(),
	}

	_, err = users.InsertOne(ctx, u)
	if err != nil {
		c.JSON(500, gin.H{"error": "Could not create account"})
		return
	}

	c.JSON(201, gin.H{
		"token": issueToken(u),
		"user": gin.H{
			"id":    u.ID.Hex(),
			"name":  u.Name,
			"email": u.Email,
		},
	})
}

func login(c *gin.Context) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if c.ShouldBindJSON(&in) != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}

	var u User
	err := users.FindOne(
		ctx,
		bson.M{
			"email": strings.ToLower(
				strings.TrimSpace(in.Email),
			),
		},
	).Decode(&u)

	if err != nil ||
		bcrypt.CompareHashAndPassword(
			[]byte(u.Password),
			[]byte(in.Password),
		) != nil {

		c.JSON(401, gin.H{
			"error": "Invalid email or password",
		})
		return
	}

	c.JSON(200, gin.H{
		"token": issueToken(u),
		"user": gin.H{
			"id":    u.ID.Hex(),
			"name":  u.Name,
			"email": u.Email,
		},
	})
}

func createPoll(c *gin.Context) {
	var in struct {
		Question        string     `json:"question"`
		Options         []string   `json:"options"`
		ExpiresAt       *time.Time `json:"expiresAt"`
		Quiz            bool       `json:"quiz"`
		CorrectOptionID string     `json:"correctOptionId"`
		CorrectAnswer   string     `json:"correctAnswer"`
	}

	if c.ShouldBindJSON(&in) != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}

	in.Question = strings.TrimSpace(in.Question)

	if len(in.Question) < 5 ||
		len(in.Question) > 200 ||
		len(in.Options) < 2 ||
		len(in.Options) > 8 {

		c.JSON(400, gin.H{
			"error": "Question must be 5–200 characters and include 2–8 options",
		})
		return
	}

	opts := make([]Option, 0, len(in.Options))

	for _, s := range in.Options {
		s = strings.TrimSpace(s)

		if len(s) < 1 || len(s) > 100 {
			c.JSON(400, gin.H{
				"error": "Each option must be 1–100 characters",
			})
			return
		}

		opts = append(opts, Option{
			ID:    primitive.NewObjectID().Hex(),
			Text:  s,
			Votes: 0,
		})
	}

	if in.ExpiresAt != nil &&
		!in.ExpiresAt.After(time.Now()) {

		c.JSON(400, gin.H{
			"error": "Expiry must be in the future",
		})
		return
	}

	id, ok := getUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}

	if in.Quiz {
		answer := strings.TrimSpace(in.CorrectOptionID)
		if answer == "" {
			answer = strings.TrimSpace(in.CorrectAnswer)
		}
		matched := ""
		for _, option := range opts {
			if option.ID == answer || option.Text == answer {
				matched = option.ID
				break
			}
		}
		if matched == "" {
			c.JSON(400, gin.H{"error": "Choose a valid correct answer"})
			return
		}
		in.CorrectOptionID = matched
	}
	name := c.GetString("userName")

	p := Poll{
		ID:              primitive.NewObjectID(),
		Question:        in.Question,
		Options:         opts,
		CreatorID:       id,
		CreatorName:     name,
		ExpiresAt:       in.ExpiresAt,
		CreatedAt:       time.Now(),
		TotalVotes:      0,
		Quiz:            in.Quiz,
		CorrectOptionID: in.CorrectOptionID,
	}

	_, err := polls.InsertOne(ctx, p)
	if err != nil {
		c.JSON(500, gin.H{"error": "Could not save poll"})
		return
	}

	c.JSON(201, p)
}

func deletePoll(c *gin.Context) {
	id, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}
	uid, ok := getUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	res := polls.FindOneAndDelete(ctx, bson.M{"_id": id, "creatorId": uid})
	if res.Err() == mongo.ErrNoDocuments {
		c.JSON(404, gin.H{"error": "Poll not found or you are not its creator"})
		return
	}
	if res.Err() != nil {
		c.JSON(500, gin.H{"error": "Could not delete poll"})
		return
	}
	_, _ = votes.DeleteMany(ctx, bson.M{"pollId": id})
	c.JSON(200, gin.H{"message": "Poll deleted"})
}

func updatePoll(c *gin.Context) {
	id, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}
	uid, ok := getUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var in struct {
		Question string   `json:"question"`
		Options  []string `json:"options"`
	}
	if c.ShouldBindJSON(&in) != nil {
		c.JSON(400, gin.H{"error": "Invalid request"})
		return
	}
	in.Question = strings.TrimSpace(in.Question)
	if len(in.Question) < 5 || len(in.Question) > 200 || len(in.Options) < 2 || len(in.Options) > 8 {
		c.JSON(400, gin.H{"error": "Question must be 5–200 characters and include 2–8 options"})
		return
	}
	var opts []Option
	seen := map[string]bool{}
	for _, s := range in.Options {
		s = strings.TrimSpace(s)
		if len(s) < 1 || len(s) > 100 || seen[strings.ToLower(s)] {
			c.JSON(400, gin.H{"error": "Options must be unique and 1–100 characters"})
			return
		}
		seen[strings.ToLower(s)] = true
		opts = append(opts, Option{ID: primitive.NewObjectID().Hex(), Text: s})
	}
	res, err := polls.UpdateOne(
		ctx,
		bson.M{"_id": id, "creatorId": uid, "totalVotes": 0},
		bson.M{"$set": bson.M{"question": in.Question, "options": opts}},
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "Could not update poll"})
		return
	}
	if res.MatchedCount == 0 {
		c.JSON(403, gin.H{"error": "Only the creator can edit a poll before its first vote"})
		return
	}
	var p Poll
	if polls.FindOne(ctx, bson.M{"_id": id}).Decode(&p) != nil {
		c.JSON(404, gin.H{"error": "Poll not found"})
		return
	}
	c.JSON(200, p)
}

func listPolls(c *gin.Context) {
	cur, err := polls.Find(
		ctx,
		bson.M{},
		options.Find().
			SetSort(bson.D{
				{Key: "createdAt", Value: -1},
			}).
			SetLimit(50),
	)

	if err != nil {
		c.JSON(500, gin.H{"error": "Database error"})
		return
	}
	defer cur.Close(ctx)

	out := []Poll{}
	if cur.All(ctx, &out) != nil {
		c.JSON(500, gin.H{"error": "Database error"})
		return
	}

	c.JSON(200, out)
}

func getPoll(c *gin.Context) {
	id, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}

	var p Poll
	err = polls.FindOne(
		ctx,
		bson.M{"_id": id},
	).Decode(&p)

	if err != nil {
		c.JSON(404, gin.H{"error": "Poll not found"})
		return
	}

	c.JSON(200, p)
}

func castVote(c *gin.Context) {
	pid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}

	var in struct {
		OptionID string `json:"optionId"`
	}

	if c.ShouldBindJSON(&in) != nil || in.OptionID == "" {
		c.JSON(400, gin.H{"error": "Select an option"})
		return
	}

	var p Poll
	if polls.FindOne(
		ctx,
		bson.M{"_id": pid},
	).Decode(&p) != nil {
		c.JSON(404, gin.H{"error": "Poll not found"})
		return
	}

	if p.ExpiresAt != nil &&
		time.Now().After(*p.ExpiresAt) {
		c.JSON(410, gin.H{"error": "Poll has closed"})
		return
	}

	valid := false
	for _, o := range p.Options {
		if o.ID == in.OptionID {
			valid = true
			break
		}
	}

	if !valid {
		c.JSON(400, gin.H{"error": "Invalid option"})
		return
	}

	uid, ok := getUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}

	_, err = votes.InsertOne(
		ctx,
		Vote{
			PollID:    pid,
			UserID:    uid,
			OptionID:  in.OptionID,
			CreatedAt: time.Now(),
		},
	)

	if err != nil {
		if mongo.IsDuplicateKeyError(err) {
			c.JSON(409, gin.H{
				"error": "You have already voted",
			})
			return
		}

		c.JSON(500, gin.H{
			"error": "Could not record vote",
		})
		return
	}

	_, err = polls.UpdateOne(
		ctx,
		bson.M{
			"_id":        pid,
			"options.id": in.OptionID,
		},
		bson.M{
			"$inc": bson.M{
				"options.$.votes": 1,
				"totalVotes":      1,
			},
		},
	)

	if err != nil {
		c.JSON(500, gin.H{
			"error": "Could not update results",
		})
		return
	}

	_ = polls.FindOne(
		ctx,
		bson.M{"_id": pid},
	).Decode(&p)

	payload, _ := json.Marshal(p)

	if err := rdb.Publish(
		ctx,
		"poll:"+pid.Hex(),
		payload,
	).Err(); err != nil {
		log.Println("Redis publish:", err)
	}

	c.JSON(200, p)
}

func pollSocket(c *gin.Context) {
	pid := c.Param("id")

	if _, err := primitive.ObjectIDFromHex(pid); err != nil {
		c.AbortWithStatus(400)
		return
	}

	conn, err := upgrader.Upgrade(
		c.Writer,
		c.Request,
		nil,
	)
	if err != nil {
		return
	}
	defer conn.Close()

	pubsub := rdb.Subscribe(ctx, "poll:"+pid)
	defer pubsub.Close()

	var p Poll
	if polls.FindOne(
		ctx,
		bson.M{"_id": mustID(pid)},
	).Decode(&p) == nil {
		data, _ := json.Marshal(p)
		_ = conn.WriteMessage(
			websocket.TextMessage,
			data,
		)
	}

	ch := pubsub.Channel()
	done := make(chan struct{})

	go func() {
		defer close(done)

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	for {
		select {
		case <-done:
			return

		case msg, ok := <-ch:
			if !ok {
				return
			}

			if err := conn.WriteMessage(
				websocket.TextMessage,
				[]byte(msg.Payload),
			); err != nil {
				return
			}

		case <-time.After(30 * time.Second):
			if err := conn.WriteMessage(
				websocket.PingMessage,
				nil,
			); err != nil {
				return
			}
		}
	}
}

func pollAnalytics(c *gin.Context) {
	pid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}
	var p Poll
	if polls.FindOne(ctx, bson.M{"_id": pid}).Decode(&p) != nil {
		c.JSON(404, gin.H{"error": "Poll not found"})
		return
	}
	cur, err := votes.Find(ctx, bson.M{"pollId": pid}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		c.JSON(500, gin.H{"error": "Could not load analytics"})
		return
	}
	defer cur.Close(ctx)
	type point struct {
		Time  string `json:"time"`
		Votes int    `json:"votes"`
	}
	points := []point{}
	buckets := map[string]int{}
	var all []Vote
	if cur.All(ctx, &all) != nil {
		c.JSON(500, gin.H{"error": "Could not load analytics"})
		return
	}
	for _, v := range all {
		key := v.CreatedAt.UTC().Truncate(time.Hour).Format(time.RFC3339)
		buckets[key]++
	}
	for k, count := range buckets {
		points = append(points, point{Time: k, Votes: count})
	}
	// Stable chronological order.
	for i := 0; i < len(points); i++ {
		for j := i + 1; j < len(points); j++ {
			if points[j].Time < points[i].Time {
				points[i], points[j] = points[j], points[i]
			}
		}
	}
	participants, _ := users.CountDocuments(ctx, bson.M{})
	rate := 0.0
	if participants > 0 {
		rate = float64(p.TotalVotes) / float64(participants) * 100
	}
	leader := ""
	highest := -1
	for _, o := range p.Options {
		if o.Votes > highest {
			highest = o.Votes
			leader = o.Text
		}
	}
	c.JSON(200, gin.H{"totalVotes": p.TotalVotes, "voteTrend": points, "participationRate": rate, "eligibleParticipants": participants, "leadingOption": leader, "closed": p.ExpiresAt != nil && time.Now().After(*p.ExpiresAt)})
}

func quizResult(c *gin.Context) {
	pid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "Invalid poll ID"})
		return
	}
	uid, ok := getUserID(c)
	if !ok {
		c.JSON(401, gin.H{"error": "Authentication required"})
		return
	}
	var p Poll
	if polls.FindOne(ctx, bson.M{"_id": pid}).Decode(&p) != nil {
		c.JSON(404, gin.H{"error": "Poll not found"})
		return
	}
	if !p.Quiz {
		c.JSON(400, gin.H{"error": "This is not a quiz"})
		return
	}
	var v Vote
	if votes.FindOne(ctx, bson.M{"pollId": pid, "userId": uid}).Decode(&v) != nil {
		c.JSON(403, gin.H{"error": "Vote before viewing the answer"})
		return
	}
	c.JSON(200, gin.H{"correct": v.OptionID == p.CorrectOptionID, "correctOptionId": p.CorrectOptionID, "score": func() int {
		if v.OptionID == p.CorrectOptionID {
			return 1
		}
		return 0
	}()})
}

func mustID(s string) primitive.ObjectID {
	id, _ := primitive.ObjectIDFromHex(s)
	return id
}





